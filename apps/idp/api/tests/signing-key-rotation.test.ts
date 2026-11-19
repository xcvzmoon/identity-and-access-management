import { eq, inArray, sql } from 'drizzle-orm';
import assert from 'node:assert/strict';
import * as valibot from 'valibot';
import { expect, onTestFinished, test } from 'vite-plus/test';
import { useDatabase } from '../server/database/index.ts';
import { signingKeys } from '../server/database/schema.ts';
import { rotateSigningKeys } from '../server/services/signing-key.service.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv } from '../server/utils/env.ts';

const enabled = process.env.IAM_PHASE9_TESTS === '1';

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
    .set({ createdAt: sql`now() - interval '91 days'` })
    .where(eq(signingKeys.id, original.kid));

  return ids;
}

test.skipIf(!enabled)(
  'concurrent rotation publishes and activates once, then restores the trusted signer',
  async () => {
    initializeEnv();

    const database = useDatabase();
    const auth = useAuth();
    const ids = await initializeKeyring();
    const [originalKid] = ids;
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

    await database
      .update(signingKeys)
      .set({ activateAfter: sql`now() - interval '1 second'` })
      .where(eq(signingKeys.id, transition.kid));

    const activated = await Promise.all([rotateSigningKeys(), rotateSigningKeys()]);
    const fresh = await auth.api.signJWT({ body: { payload } });

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
