import { defineConfig } from 'nitro';
export default defineConfig({
  compatibilityDate: '2026-11-16',
  serverDir: './server',
  serverEntry: './server/entry.ts',
  handlers: [
    {
      route: '/.well-known/openid-configuration',
      method: 'GET',
      handler: './server/handlers/oidc-discovery.ts',
    },
  ],
});
