import { text } from 'node:stream/consumers';
import { useDatabase } from '../server/database/index.ts';
import { rotateManagedClientSecret } from '../server/services/registration.service.ts';
import { initializeEnv } from '../server/utils/env.ts';

const ARGUMENT_OFFSET = 2;
const EMPTY = 0;
const [clientId, ...extra] = process.argv.slice(ARGUMENT_OFFSET);
if (!clientId || extra.length > EMPTY || process.stdin.isTTY || process.stdout.isTTY) {
  throw new Error('Supply one client ID, pipe the session cookie on stdin and capture stdout.');
}

initializeEnv();
const database = useDatabase();
try {
  const cookie = await text(process.stdin);
  const headers = new Headers({ cookie: cookie.trim() });
  const secret = await rotateManagedClientSecret(headers, clientId);

  process.stdout.write(secret);
} catch {
  process.stderr.write('Client secret rotation failed. Check the client, session and database.\n');
  process.exitCode = 1;
} finally {
  await database.$client.end();
}
