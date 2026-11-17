// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-16',
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
  devServer: { port: 5173 },
  runtimeConfig: {
    public: {
      apiUrl: 'http://localhost:3000',
    },
  },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/image', '@nuxt/ui', '@vueuse/nuxt/module', 'nuxt-auth-utils'],
  auth: {
    loadStrategy: 'none',
  },
  colorMode: {
    preference: 'dark',
  },
});
