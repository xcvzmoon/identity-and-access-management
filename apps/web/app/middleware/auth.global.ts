export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || (to.meta.auth !== 'user' && to.meta.auth !== 'guest')) {
    return;
  }

  const session = useUserSession();
  await session.refresh();

  if (to.meta.auth === 'user' && !session.loggedIn.value) {
    return navigateTo({
      path: '/signin',
      query: { redirect: to.path },
    });
  }

  if (to.meta.auth === 'guest' && session.loggedIn.value) {
    return navigateTo('/account');
  }
});
