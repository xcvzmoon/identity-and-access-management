# Phase 4. Build the OIDC issuer and app grants

[Implementation plan](overview.md)

## Changes

- Mount Better Auth's OAuth Provider and JWT handlers in `apps/idp/api`.
  Publish discovery and JWKS at the configured issuer. Connect the
  sign-in and consent pages in `apps/idp/web` to the provider flow.
- Store signing keys in IdP-owned persistent storage. Use the evaluated
  RS256 signing and JWKS path. Phase 9 adds automated rotation.
- Give each installation a confidential OAuth client, exact callback
  URLs, and tenant-scoped assignments and roles. Check grants at
  authorization and code exchange.
- Ask for customer app consent on first authorization and when approved
  access changes. Identify the application on the consent page. Reserve
  the first-party consent exemption for the console registration.
- Record authorization outcomes in the IdP API, including when SSO is
  reused. Add a reference server-backed app to exercise the issuer.

## Verification

Complete Authorization Code with S256 PKCE through the reference app.
Validate the discovery issuer, ID token, and signing key. Reject an
unregistered callback, missing PKCE, and invalid or replayed codes.
Register the same app in two organizations and verify a client cannot
use the other installation's grant. Revoke a grant between code issuance
and exchange and verify the exchange fails. Check first consent, SSO
reuse with current consent, and renewed consent after access changes.
