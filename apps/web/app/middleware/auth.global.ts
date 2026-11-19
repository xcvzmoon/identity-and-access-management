export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.meta.auth !== 'user') {
    return;
  }

  const session = useUserSession();
  await session.refresh();

  if (!session.loggedIn.value) {
    const query = new URLSearchParams({ redirect: to.path });
    return navigateTo(`/signin?${query}`, { external: true });
  }
});
