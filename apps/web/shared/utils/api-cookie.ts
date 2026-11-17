/**
 * Selects the Better Auth cookies needed by the API.
 * @param {string | null} header - Incoming Cookie header.
 * @returns {string} Cookie header containing only Better Auth cookies.
 */
export function selectApiCookies(header: string | null): string {
  return (header ?? '')
    .split(';')
    .map((cookie) => cookie.trim())
    .filter((cookie) => /^(?:__Secure-)?better-auth\./u.test(cookie))
    .join('; ');
}
