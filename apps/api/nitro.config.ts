import { defineConfig } from 'nitro';
import path from 'node:path';

const webAssets = path.resolve(import.meta.dirname, '../web/.output/public');
const privatePage = {
  headers: {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-frame-options': 'DENY',
  },
};

export default defineConfig({
  compatibilityDate: '2026-11-16',
  serverDir: './server',
  serverEntry: './server/entry.ts',
  publicAssets: [
    {
      dir: webAssets,
      ignore: ['**/*.html'],
    },
  ],
  serverAssets: [
    {
      dir: webAssets,
      baseName: 'iam-web',
      pattern: 'index.html',
    },
  ],
  routeRules: {
    '/': privatePage,
    '/signin': privatePage,
    '/signup': privatePage,
    '/account': privatePage,
    '/recover-password': privatePage,
    '/oidc/**': {
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'same-origin',
        'x-frame-options': 'DENY',
      },
    },
  },
  handlers: [
    {
      route: '/.well-known/openid-configuration',
      method: 'GET',
      handler: './server/handlers/oidc-discovery.ts',
    },
  ],
});
