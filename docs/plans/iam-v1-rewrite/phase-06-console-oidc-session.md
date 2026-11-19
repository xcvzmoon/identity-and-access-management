# Phase 6. Build the console OIDC session

[Implementation plan](overview.md)

## Changes

- Register the console as a confidential client. Bind the authorization request and callback to a one-time browser transaction with PKCE, state, and nonce. Validate the ID token server-side before creating a session and allow return destinations on the console origin.
- Store session and token state on the console server and issue a Secure, HTTP-only, host-only console cookie in deployed environments. Move account and admin pages to the console's own session interface. When an access token expires, reauthorize through the existing IdP SSO session or use renewal that was verified against the live revocation rules in phase 1.
- Offer app sign-out and IAM sign-out. App sign-out clears console session state. IAM sign-out also ends the current IdP SSO session through the IdP flow.

## Verification

Use a browser to open a protected console page, sign in on the IdP origin, and return to the requested page. Exercise a verified user with zero memberships, then open a reference app to check SSO reuse. Test unsafe return targets and failed or repeated callbacks. Confirm distinct cookies and exercise expiry and both sign-out actions.
