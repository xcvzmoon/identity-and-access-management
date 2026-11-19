import * as valibot from 'valibot';

/** Better Auth's response when the browser must continue an authorization request. */
export const authorizationRedirectSchema = valibot.object({
  redirect: valibot.literal(true),
  url: valibot.pipe(valibot.string(), valibot.nonEmpty()),
});

/**
 * Follows the issuer's continuation after sign-in or consent.
 * @param {object} redirect - Validated redirect returned by the issuer.
 */
export async function followAuthorizationRedirect(
  redirect: valibot.InferOutput<typeof authorizationRedirectSchema>,
): Promise<void> {
  const destination = new URL(redirect.url, globalThis.location.origin);

  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
    throw new Error('Invalid authorization redirect.');
  }

  await navigateTo(destination.href, {
    external: true,
    replace: true,
  });
}
