export default defineNuxtRouteMiddleware(async (to) => {
  const app = useNuxtApp();

  if (to.meta.auth === 'user' && !app.$authUser.value) {
    return navigateTo({
      path: '/signin',
      query: { redirect: to.fullPath },
    });
  }

  if (to.meta.auth === 'guest' && app.$authUser.value) {
    return navigateTo('/account');
  }
});
