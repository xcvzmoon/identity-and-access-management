import type { Jwk } from 'better-auth/plugins/jwt';
import { symmetricEncrypt } from 'better-auth/crypto';
import { generateExportedKeyPair } from 'better-auth/plugins/jwt';
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { useDatabase } from '../database/index.ts';
import { signingKeys } from '../database/schema.ts';
import { useEnv } from '../utils/env.ts';

type Database = Omit<ReturnType<typeof useDatabase>, '$client'>;
type RotationOutcome = {
  outcome: 'published' | 'activated' | 'rolled-back';
  kid: string;
  previousKid: string;
};

const FIRST = 0;
const VERIFY_ONLY = new Date('1970-01-01T00:00:00Z');

const active = isNull(signingKeys.expiresAt);
const staged = isNotNull(signingKeys.activateAfter);
const retirementCutoff = sql`clock_timestamp() - interval '30 days'`;

/**
 * PostgreSQL controls the JWKS publication window. Better Auth uses expiresAt
 * for signing eligibility, so every verification-only entry gets a past date.
 * The plugin grace period keeps those entries in its public JWKS response.
 *
 * @param {Database} database - Connection serving the issuer request.
 * @returns {Promise<Jwk[]>} Published keys. Only the active entry carries signing material.
 */
export async function readSigningKeys(database: Database): Promise<Jwk[]> {
  const keys = await database
    .select()
    .from(signingKeys)
    .where(or(active, staged, gt(signingKeys.expiresAt, retirementCutoff)));

  return keys.map((key): Jwk => {
    const entry: Jwk = {
      id: key.id,
      alg: 'RS256',
      createdAt: key.createdAt,
      publicKey: key.publicKey,
      privateKey: key.expiresAt ? '' : key.privateKey,
    };

    if (key.expiresAt) {
      entry.expiresAt = VERIFY_ONLY;
    }

    return entry;
  });
}

/**
 * @param {Database} database - Connection handling the first issuer request.
 * @param {Omit<Jwk, 'id'>} candidate - Better Auth's encrypted bootstrap key.
 * @returns {Promise<Jwk>} The winning key when issuers initialize concurrently.
 */
export async function persistInitialKey(
  database: Database,
  candidate: Omit<Jwk, 'id'>,
): Promise<Jwk> {
  const keys = await database
    .insert(signingKeys)
    .values({
      ...candidate,
      alg: 'RS256',
    })
    .onConflictDoUpdate({
      target: signingKeys.alg,
      targetWhere: isNull(signingKeys.expiresAt),
      set: { alg: 'RS256' },
    })
    .returning();
  const key = keys.at(FIRST);
  if (!key) {
    throw new Error('The IdP signing key could not be persisted.');
  }

  return {
    id: key.id,
    publicKey: key.publicKey,
    privateKey: key.privateKey,
    createdAt: key.createdAt,
    alg: 'RS256',
  };
}

async function activate(transaction: Database, kid: string): Promise<void> {
  await transaction
    .update(signingKeys)
    .set({ expiresAt: sql`clock_timestamp()` })
    .where(active);
  await transaction
    .update(signingKeys)
    .set({
      expiresAt: null,
      activateAfter: null,
    })
    .where(eq(signingKeys.id, kid));
}

async function publish(transaction: Database): Promise<string> {
  const env = useEnv();
  const pair = await generateExportedKeyPair({ jwks: { keyPairConfig: { alg: 'RS256' } } });
  const encrypted = await symmetricEncrypt({
    key: env.betterAuthSecret,
    data: JSON.stringify(pair.privateWebKey),
  });
  const [key] = await transaction
    .insert(signingKeys)
    .values({
      alg: pair.alg,
      createdAt: sql`clock_timestamp()`,
      activateAfter: sql`clock_timestamp() + interval '1 hour'`,
      expiresAt: VERIFY_ONLY,
      publicKey: JSON.stringify(pair.publicWebKey),
      privateKey: JSON.stringify(encrypted),
    })
    .returning({ id: signingKeys.id });

  return key.id;
}

/**
 * @param {string} [rollbackKid] - Restores this previously active key during its overlap period.
 * @returns {Promise<RotationOutcome | null>} Committed transition, or null when no action is due.
 */
export async function rotateSigningKeys(rollbackKid?: string): Promise<RotationOutcome | null> {
  const database = useDatabase();
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('iam_idp.signing_keys'))`);
    await transaction
      .delete(signingKeys)
      .where(and(isNull(signingKeys.activateAfter), lt(signingKeys.expiresAt, retirementCutoff)));

    const currentRows = await transaction
      .select({
        id: signingKeys.id,
        due: sql<boolean>`${signingKeys.createdAt} <= clock_timestamp() - interval '90 days'`,
      })
      .from(signingKeys)
      .where(active);
    const current = currentRows.at(FIRST);

    if (!current) {
      if (rollbackKid) {
        throw new Error('No active signing key.');
      }

      return null;
    }

    if (rollbackKid) {
      const trustedRows = await transaction
        .select({ id: signingKeys.id })
        .from(signingKeys)
        .where(
          and(
            eq(signingKeys.id, rollbackKid),
            isNull(signingKeys.activateAfter),
            isNotNull(signingKeys.expiresAt),
          ),
        );
      const trusted = trustedRows.at(FIRST);

      if (!trusted) {
        throw new Error('Rollback requires a retained, previously active key.');
      }

      await transaction.delete(signingKeys).where(staged);
      await activate(transaction, trusted.id);

      return {
        outcome: 'rolled-back',
        kid: trusted.id,
        previousKid: current.id,
      };
    }

    const pendingRows = await transaction
      .select({
        id: signingKeys.id,
        ready: sql<boolean>`${signingKeys.activateAfter} <= clock_timestamp()`,
      })
      .from(signingKeys)
      .where(staged);
    const pending = pendingRows.at(FIRST);

    if (pending?.ready) {
      await activate(transaction, pending.id);

      return {
        outcome: 'activated',
        kid: pending.id,
        previousKid: current.id,
      };
    }

    if (current.due && !pending) {
      const kid = await publish(transaction);
      return {
        outcome: 'published',
        kid,
        previousKid: current.id,
      };
    }

    return null;
  });
}
