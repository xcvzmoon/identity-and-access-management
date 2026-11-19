import * as valibot from 'valibot';
import { useDatabase } from '../server/database/index.ts';
import { rotateSigningKeys } from '../server/services/signing-key.service.ts';
import { initializeEnv } from '../server/utils/env.ts';

const ARGUMENT_OFFSET = 2;
const kid = valibot.parse(
  valibot.pipe(valibot.string(), valibot.uuid('Supply the trusted, previously active key ID.')),
  process.argv.at(ARGUMENT_OFFSET),
);

initializeEnv();
const database = useDatabase();

try {
  const result = await rotateSigningKeys(kid);

  console.info(
    JSON.stringify({
      event: 'signing-key-rotation',
      ...result,
    }),
  );
} catch {
  console.error(
    JSON.stringify({
      event: 'signing-key-rotation',
      outcome: 'rollback-failed',
      kid,
    }),
  );

  process.exitCode = 1;
} finally {
  await database.$client.end();
}
