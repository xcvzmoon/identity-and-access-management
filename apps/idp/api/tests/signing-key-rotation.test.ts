import { eq, inArray, sql } from 'drizzle-orm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as valibot from 'valibot';
import { expect, onTestFinished, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { signingKeys } from '../server/database/schema.ts';
import { rotateSigningKeys } from '../server/services/signing-key.service.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv, useEnv } from '../server/utils/env.ts';

type RotationCheck = { status: number | null; message: string };

const HEALTHY = 0;
const CRITICAL = 2;

const enabled = process.env.IAM_PHASE9_TESTS === '1';

function rotationCheck(): RotationCheck {
  const env = useEnv();
  const script = fileURLToPath(
    new URL('../scripts/sh.check-signing-key-rotation.sh', import.meta.url),
  );
  const result = spawnSync('sh', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGHOST: env.db.host,
      PGPORT: String(env.db.port),
      PGDATABASE: env.db.database,
      PGUSER: env.db.user,
      PGPASSWORD: env.db.password,
      PGSSLMODE: env.db.ssl ? 'require' : 'disable',
    },
  });

  return {
    status: result.status,
    message: result.stdout.trim(),
  };
}

function signingKid(token: string): string {
  const [header] = token.split('.');
  const parsed = valibot.parse(
    valibot.object({ kid: valibot.string() }),
    JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
  );
  return parsed.kid;
}

async function initializeKeyring(): Promise<string[]> {
  const database = useDatabase();
  const auth = useAuth();
  const existing = await database.select({ id: signingKeys.id }).from(signingKeys);

  expect(existing, 'Use a migrated disposable database with an empty keyring.').toEqual([]);

  expect(rotationCheck()).toEqual({
    status: CRITICAL,
    message: 'CRITICAL: expected exactly one active RS256 signer',
  });

  const {
    keys: [original],
  } = await auth.api.getJwks();

  assert.ok(original.kid);
  const ids = [original.kid];

  onTestFinished(async () => {
    await database.delete(signingKeys).where(inArray(signingKeys.id, ids));
    await database.$client.end();
  });

  await database
    .update(signingKeys)
    .set({ createdAt: sql`now() - interval '92 days'` })
    .where(eq(signingKeys.id, original.kid));

  return ids;
}

async function delayActivation(kid: string): Promise<void> {
  const database = useDatabase();
  await database
    .update(signingKeys)
    .set({ activateAfter: sql`now() - interval '3 minutes'` })
    .where(eq(signingKeys.id, kid));

  expect(rotationCheck()).toEqual({
    status: CRITICAL,
    message: 'CRITICAL: staged key activation is overdue',
  });
}

test.skipIf(!enabled)(
  'concurrent rotation publishes and activates once, then restores the trusted signer',
  async () => {
    initializeEnv();

    const auth = useAuth();
    const ids = await initializeKeyring();
    const [originalKid] = ids;
    expect(rotationCheck()).toEqual({
      status: CRITICAL,
      message: 'CRITICAL: active signing key is over 91 days old',
    });
    const published = await Promise.all([rotateSigningKeys(), rotateSigningKeys()]);
    const transition = published.find((outcome) => outcome?.outcome === 'published');
    expect(published).toContain(null);
    if (!transition) {
      throw new Error('Expected a staged replacement.');
    }

    ids.push(transition.kid);

    const staged = await auth.api.getJwks();
    const payload = { sub: 'test-user' };
    const old = await auth.api.signJWT({ body: { payload } });

    expect(new Set(staged.keys.map((key) => key.kid))).toEqual(new Set(ids));
    expect(signingKid(old.token)).toBe(originalKid);
    expect(await rotateSigningKeys()).toBeNull();

    await delayActivation(transition.kid);
    const activated = await Promise.all([rotateSigningKeys(), rotateSigningKeys()]);
    const fresh = await auth.api.signJWT({ body: { payload } });

    expect(rotationCheck().status).toBe(HEALTHY);
    expect(signingKid(fresh.token)).toBe(transition.kid);
    expect(activated).toContain(null);
    expect(activated).toContainEqual({
      outcome: 'activated',
      kid: transition.kid,
      previousKid: originalKid,
    });
    expect(await auth.api.verifyJWT({ body: old })).toMatchObject({ payload });
    expect(await auth.api.verifyJWT({ body: fresh })).toMatchObject({ payload });
    expect(await rotateSigningKeys(originalKid)).toMatchObject({ outcome: 'rolled-back' });

    const restored = await auth.api.signJWT({ body: { payload } });
    expect(signingKid(restored.token)).toBe(originalKid);
  },
);
