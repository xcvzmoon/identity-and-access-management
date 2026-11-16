// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-16',
  devtools: {
    enabled: true,
  },
  typescript: {
    typeCheck: true,
    strict: true,
  },
  css: ['~/assets/css/main.css'],
  modules: ['@nuxt/image', '@nuxt/ui', '@vueuse/nuxt/module'],
});
