# Phase 4. Move the OIDC issuer and app grants

[Implementation plan](overview.md)

## Changes

- Mount Better Auth's OAuth Provider and JWT handlers on the IdP origin. Expose provider discovery and JWKS, and connect the IAM login and consent screens to the provider's flow. Route the reference app through the new issuer.
- Give each customer installation a confidential OAuth client, exact registered callbacks, and its own tenant-scoped assignments and roles. Keep the grant checks at authorization and code exchange.
- Prompt for customer app consent on first authorization and when approved access changes. Scope the first-party consent policy to the reserved console client.

## Verification

Complete Authorization Code with PKCE for the reference app. Verify the issuer, signed ID token, registered callback, and denial for invalid or replayed codes. Register the same app in two organizations and try each tenant's client against the other's grant. Verify first consent, SSO reuse with current consent, and renewed consent after approved access changes.
