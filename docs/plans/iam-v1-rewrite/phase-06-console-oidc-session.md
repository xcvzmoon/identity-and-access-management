# Phase 6. Build the console OIDC session

[Implementation plan](overview.md)

## Changes

- Use the first-party registration from Phase 4 in `apps/console/api`.
  Bind the authorization request and callback to a one-time browser
  transaction with S256 PKCE, state, and nonce. Validate issuer, audience,
  nonce, signature, and expiry before creating a session. Allow return
  destinations on the console origin.
- Store console session and token state server-side. In deployed
  environments issue a Secure, HTTP-only, host-only console cookie.
  Reauthorize through the IdP when a token expires, or verify any renewal
  path against the live revocation rules before enabling it.
- Add the signed-in account experience in `apps/console/web`. Allow
  verified users with zero memberships to manage their own accounts.
- Offer app sign-out and IAM sign-out. App sign-out clears the console
  session. IAM sign-out also ends the current SSO session through the IdP.

## Verification

Open a protected console page and complete the hosted IdP sign-in.
Verify the browser returns to the requested console page with a separate
session cookie. Sign in as a verified user with zero memberships and use
the same SSO session in the reference app. Test unsafe return targets,
failed and replayed callbacks, expiry, and both sign-out actions.
