# Phase 9. Automate signing-key rotation

[Implementation plan](overview.md)

## Changes

- Use the persistent IdP key store from Phase 4. Keep private keys
  encrypted inside the IdP boundary. Serialize publication and
  activation so issuer processes observe the same active key.
- Automate routine publication, activation, overlap, and status reporting.
  Define the wait before activation using client JWKS cache behavior.
  Retain previous public keys for the lifetime of tokens they signed.
- Document rollback to a trusted published key and the emergency
  procedure for a compromised key. Record key IDs and outcomes in
  operational logs.

## Verification

Stage a replacement and compare JWKS from two IdP processes. Verify
signing stays on the current key during the publication window, then
verify new tokens use the new key ID and unexpired old tokens still
validate. Exercise scheduler retries, failed-rotation alerts, and rollback.
Automated routine rotation and a rollback rehearsal are required before
the first external customer.
