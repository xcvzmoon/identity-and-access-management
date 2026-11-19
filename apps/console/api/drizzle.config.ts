import { defineConfig } from 'drizzle-kit';
import { initializeEnv, useEnv } from './server/utils/env.ts';

initializeEnv();

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './server/database/schema/index.ts',
  schemaFilter: ['iam_console'],
  migrations: { schema: 'iam_console_migrations' },
  dbCredentials: useEnv().db,
  breakpoints: true,
  verbose: true,
});
