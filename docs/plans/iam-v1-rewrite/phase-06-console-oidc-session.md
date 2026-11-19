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

## Results

Chromium opened a protected console URL with a query string, signed in at
the IdP as a verified user with zero memberships, and returned to that URL.
The console validated the signed ID token, matched the UserInfo subject,
and displayed the account associated with its own Secure, HTTP-only cookie.
An invalid code, a repeated callback, and an external return URL were rejected.

The console discards the tokens after reading the profile. Its PostgreSQL
session expires at the earlier of the access token and ID token deadlines.
Expiring the stored session produced a 401. Reopening the account page
completed a new authorization using the current SSO session.

Console sign-out cleared local access. The same browser then opened Reports
with a grant and consent, without entering credentials again. IAM sign-out
cleared the console session. After confirmation at the IdP, Reports returned
401 on the next request and the console prompted for credentials.
[Run the console session fixture](../../validation.md#console-session)
