import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import * as valibot from 'valibot';
import { useDatabase } from '../server/database/index.ts';
import { users } from '../server/database/schema.ts';
import { useAuth } from '../server/utils/auth.ts';
import { initializeEnv } from '../server/utils/env.ts';
import { finishAccountEmail } from '../server/utils/mail.ts';

const ARGUMENT_START = 2;
const PASSWORD_BYTES = 32;
const FIRST = 0;
const args = valibot.tuple([
  valibot.pipe(valibot.string(), valibot.trim(), valibot.email(), valibot.toLowerCase()),
  valibot.pipe(valibot.string(), valibot.trim(), valibot.nonEmpty()),
]);
const [email, name] = valibot.parse(args, process.argv.slice(ARGUMENT_START));

initializeEnv();

const database = useDatabase();
const auth = useAuth();

try {
  const matches = await database.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!matches.at(FIRST)) {
    await auth.api.signUpEmail({
      body: {
        name,
        email,
        password: randomBytes(PASSWORD_BYTES).toString('base64url'),
      },
    });
  }

  const accounts = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  const account = accounts.at(FIRST);
  if (!account) {
    throw new Error('Operator account provisioning failed.');
  }

  process.stdout.write(`IAM user ID: ${account.id}\n`);
} finally {
  await finishAccountEmail();
  await database.$client.end();
}
