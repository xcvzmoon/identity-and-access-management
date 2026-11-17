type ApiFetchOptions = { $fetch: typeof $fetch };

/** Read from the configured API with Nuxt SSR and hydration support. */
export const useApi = createUseFetch((): ApiFetchOptions => ({
  $fetch: useNuxtApp().$api,
}));
