import { defineConfig } from 'drizzle-kit';
import { databaseTlsOptions, useDatabaseEnv } from './src/utils/env.ts';

const env = useDatabaseEnv({
  workspacePath: import.meta.dirname,
});

export default defineConfig({
  dialect: 'postgresql',
  schemaFilter: ['iam'],
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    host: env.host,
    port: env.port,
    user: env.user,
    password: env.password,
    database: env.database,
    ssl: databaseTlsOptions(env.ssl),
  },
});
