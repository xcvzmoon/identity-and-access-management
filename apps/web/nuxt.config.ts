// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
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
