export default defineNuxtRouteMiddleware(async (to) => {
  const session = useUserSession();

  if (to.meta.auth === 'user' && !session.loggedIn.value) {
    return navigateTo({
      path: '/signin',
      query: { redirect: to.fullPath },
    });
  }

  if (to.meta.auth === 'guest' && session.loggedIn.value) {
    return navigateTo('/account');
  }
});
