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
  runtimeConfig: {
    apiUrl: 'http://127.0.0.1:3000',
    idpOrigin: 'http://localhost:5176',
  },
  routeRules: {
    '/': privatePage,
    '/account': privatePage,
    '/admin': privatePage,
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
