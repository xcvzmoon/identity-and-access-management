// https://nuxt.com/docs/api/configuration/nuxt-config
const privatePage = {
  headers: {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'x-frame-options': 'DENY',
  },
};

export default defineNuxtConfig({
  app: { buildAssetsDir: '/_idp/' },
  nitro: { serverEntry: './server/entry.ts' },
  runtimeConfig: {
    apiUrl: 'http://127.0.0.1:3000',
    public: { webOrigin: 'http://localhost:5173' },
  },
  routeRules: {
    '/': privatePage,
    '/signin': privatePage,
    '/signup': privatePage,
    '/recover-password': privatePage,
    '/oidc/**': {
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'strict-origin',
        'x-frame-options': 'DENY',
      },
    },
  },
  compatibilityDate: '2026-11-16',
  ssr: false,
  devtools: {
    enabled: true,
  },
  typescript: {
    typeCheck: true,
    strict: true,
    appTsConfig: {
      compilerOptions: {
        rootDir: import.meta.dirname,
      },
    },
  },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/ui', '@vueuse/nuxt/module'],
  icon: {
    provider: 'none',
    serverBundle: false,
    clientBundle: { scan: true },
  },
  colorMode: {
    preference: 'dark',
  },
});
