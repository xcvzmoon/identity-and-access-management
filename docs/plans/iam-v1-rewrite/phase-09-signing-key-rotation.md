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

## Rehearsal results

Two built Nitro processes shared a disposable PostgreSQL 18 database and used the IdP runtime role. Both logged a failed tick while the key table was unavailable. After access was restored, one replica published a replacement and the other activated it. The rehearsal advanced the database timestamps to exercise the 90-day and one-hour deadlines.

Both JWKS endpoints returned the same public keys. Tokens issued before publication and during staging used the original key. After activation, a fresh token used the replacement and the original token still verified. The rollback command restored the original signer, and signatures from both keys verified against the public JWKS.

Run the concurrency regression from `apps/idp/api` with the runtime environment pointed at a migrated disposable database with an empty keyring:

```sh
IAM_PHASE9_TESTS=1 vp test tests/signing-key-rotation.test.ts
```

[Timing, monitoring and incident procedures](../../signing-key-rotation.md)
