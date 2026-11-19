import { defineConfig } from 'nitro';
import path from 'node:path';
import { checkEnvFile } from './server/utils/env.ts';

export default defineConfig({
  compatibilityDate: '2026-11-16',
  serverDir: './server',
  hooks: {
    'build:before': (nitro) => {
      const envFile = path.resolve(nitro.options.rootDir, '.env');
      checkEnvFile(envFile);
    },
  },
});
