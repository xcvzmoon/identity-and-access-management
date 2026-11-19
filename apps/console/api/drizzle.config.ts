import { defineConfig } from 'drizzle-kit';
import { initializeEnv, useEnv } from './server/utils/env.ts';

initializeEnv();

const env = useEnv();

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './server/database/schema.ts',
  schemaFilter: ['iam_console'],
  migrations: { schema: 'iam_console_migrations' },
  dbCredentials: env.db,
  breakpoints: true,
  verbose: true,
});
