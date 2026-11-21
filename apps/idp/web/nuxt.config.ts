import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  hooks: {
    'nitro:config': (config) => {
      const handler = fileURLToPath(
        new URL('../../../shared/server/fatal-error.ts', import.meta.url),
      );
      const handlers = config.errorHandler ?? [];

      config.errorHandler = [handler, ...[handlers].flat()];
    },
  },
  compatibilityDate: '2026-11-16',
  routeRules: {
    '/**': {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex',
      },
    },
  },
  devtools: {
    enabled: false,
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
  modules: ['@nuxt/ui'],
  icon: {
    clientBundle: {
      icons: ['lucide:building-2', 'lucide:key-round', 'lucide:loader', 'lucide:shield-check'],
    },
  },
  colorMode: {
    preference: 'dark',
  },
});
