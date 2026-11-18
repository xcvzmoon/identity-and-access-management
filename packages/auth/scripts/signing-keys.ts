import { schema, useDatabase } from '@iam/database';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { generateExportedKeyPair } from 'better-auth/plugins';
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import * as valibot from 'valibot';
import { useAuthEnv } from '../src/utils/env.ts';
import {
  issuerSigningAlgorithm,
  lockSigningKeys,
  signingKeyGraceSeconds,
} from '../src/utils/signing-key-policy.ts';

const { jwks } = schema;
const argumentOffset = 2;
const activeKeyLimit = 2;
const firstRow = 0;
const failureExitCode = 1;
const inactiveSince = sql`statement_timestamp() - interval '5 minutes'`;
const keyIdSchema = valibot.pipe(valibot.string(), valibot.uuid());
const commandSchema = valibot.union([
  valibot.strictTuple([valibot.literal('stage'), keyIdSchema]),
  valibot.strictTuple([valibot.literal('activate'), keyIdSchema, keyIdSchema]),
]);
const signingKeyErrors = {
  SIGNING_KEY_INVALID_COMMAND: 'Use stage <active-kid> or activate <active-kid> <published-kid>.',
  SIGNING_KEY_SECRET_MISMATCH: 'AUTH_SECRET cannot decrypt the issuer key.',
  SIGNING_KEY_ACTIVE_MISMATCH: 'The expected key must be the only active RS256 signing key.',
  SIGNING_KEY_REPLACEMENT_UNAVAILABLE:
    'The replacement key must be inactive and still published in JWKS.',
};

class SigningKeyOperationError extends Error {
  public override readonly name = 'SigningKeyOperationError';
  public readonly code: keyof typeof signingKeyErrors;

  public constructor(code: keyof typeof signingKeyErrors, cause?: unknown) {
    super(signingKeyErrors[code], { cause });
    this.code = code;
  }
}

async function verifySecret(privateKey: string, secret: string): Promise<void> {
  try {
    const data = valibot.parse(valibot.string(), JSON.parse(privateKey));
    await symmetricDecrypt({
      key: secret,
      data,
    });
  } catch (error) {
    throw new SigningKeyOperationError('SIGNING_KEY_SECRET_MISMATCH', error);
  }
}

async function manageSigningKeys(
  command: valibot.InferOutput<typeof commandSchema>,
): Promise<void> {
  const [operation, expectedActiveKeyId, replacementKeyId] = command;
  const { secret } = useAuthEnv();
  const database = useDatabase();

  try {
    const keyId = await database.transaction(
      async (transaction) => {
        await transaction.execute(lockSigningKeys);
        const activeKeys = await transaction
          .select({
            id: jwks.id,
            privateKey: jwks.privateKey,
          })
          .from(jwks)
          .where(
            and(
              eq(jwks.alg, issuerSigningAlgorithm),
              or(isNull(jwks.expiresAt), gt(jwks.expiresAt, sql`statement_timestamp()`)),
            ),
          )
          .limit(activeKeyLimit);
        const activeKey = activeKeys.at(firstRow);
        if (activeKeys.length === activeKeyLimit || activeKey?.id !== expectedActiveKeyId) {
          throw new SigningKeyOperationError('SIGNING_KEY_ACTIVE_MISMATCH');
        }

        await verifySecret(activeKey.privateKey, secret);

        if (operation === 'stage') {
          const { publicWebKey, privateWebKey, alg } = await generateExportedKeyPair({
            jwks: { keyPairConfig: { alg: issuerSigningAlgorithm } },
          });
          const encrypted = await symmetricEncrypt({
            key: secret,
            data: JSON.stringify(privateWebKey),
          });
          const [{ id }] = await transaction
            .insert(jwks)
            .values({
              alg,
              publicKey: JSON.stringify(publicWebKey),
              privateKey: JSON.stringify(encrypted),
              createdAt: sql`statement_timestamp()`,
              expiresAt: inactiveSince,
            })
            .returning({ id: jwks.id });
          return id;
        }

        const publishedKeys = await transaction
          .select({ privateKey: jwks.privateKey })
          .from(jwks)
          .where(
            and(
              eq(jwks.id, replacementKeyId),
              eq(jwks.alg, issuerSigningAlgorithm),
              lte(jwks.expiresAt, sql`statement_timestamp()`),
              gt(
                jwks.expiresAt,
                sql`statement_timestamp() - make_interval(secs => ${signingKeyGraceSeconds})`,
              ),
            ),
          );
        const replacement = publishedKeys.at(firstRow);
        if (!replacement) {
          throw new SigningKeyOperationError('SIGNING_KEY_REPLACEMENT_UNAVAILABLE');
        }

        await verifySecret(replacement.privateKey, secret);
        await transaction
          .update(jwks)
          .set({ expiresAt: inactiveSince })
          .where(eq(jwks.id, activeKey.id));
        await transaction
          .update(jwks)
          .set({ expiresAt: null })
          .where(eq(jwks.id, replacementKeyId));
        return replacementKeyId;
      },
      { isolationLevel: 'read committed' },
    );
    process.stdout.write(`${keyId}\n`);
  } finally {
    await database.$client.end();
  }
}

const command = valibot.safeParse(commandSchema, process.argv.slice(argumentOffset));

try {
  if (!command.success) {
    throw new SigningKeyOperationError('SIGNING_KEY_INVALID_COMMAND');
  }

  await manageSigningKeys(command.output);
} catch (error) {
  const message =
    error instanceof SigningKeyOperationError
      ? `${error.code} ${error.message}`
      : 'SIGNING_KEY_OPERATION_FAILED Signing key operation failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = failureExitCode;
}
