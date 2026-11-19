export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.meta.auth !== 'guest') {
    return;
  }

  const session = useUserSession();
  await session.refresh();

  if (session.loggedIn.value) {
    const { webOrigin } = useRuntimeConfig().public;
    const destination = new URL(to.query.redirect === '/admin' ? '/admin' : '/account', webOrigin);
    return navigateTo(destination.href, { external: true });
  }
});
