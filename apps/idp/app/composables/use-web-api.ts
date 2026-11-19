export function useWebApi(): typeof $fetch {
  const { webOrigin } = useRuntimeConfig().public;
  return $fetch.create({
    baseURL: webOrigin,
    credentials: 'include',
  });
}
