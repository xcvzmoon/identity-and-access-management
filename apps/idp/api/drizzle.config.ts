import { defineConfig } from 'drizzle-kit';
import { useEnv } from './server/utils/env.ts';

const env = useEnv();

export default defineConfig({
  dialect: 'postgresql',
  out: './migrations',
  schema: './server/database/schema/index.ts',
  dbCredentials: {
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    ssl: env.db.ssl,
  },
  breakpoints: true,
  verbose: true,
});
