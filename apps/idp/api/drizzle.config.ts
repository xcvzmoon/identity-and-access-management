import { defineConfig } from 'drizzle-kit';
import { initializeEnv, useEnv } from './server/utils/env.ts';

initializeEnv();

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './server/database/schema/index.ts',
  schemaFilter: ['iam_idp'],
  migrations: { schema: 'iam_idp_migrations' },
  dbCredentials: useEnv().db,
  breakpoints: true,
  verbose: true,
});
