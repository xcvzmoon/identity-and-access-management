# Phase 9. Automate signing-key rotation

[Implementation plan](overview.md) · [Current rotation runbook](../../pilot.md#rotate-the-issuer-signing-key)

## Changes

- Carry forward serialized key publication and activation in the shared key store. Define the schedule and overlap using client JWKS cache behavior and token lifetimes.
- Automate staged publication, activation, and status reporting. Rehearse rollback to a trusted, published key and document the separate emergency procedure for a compromised key.
- Keep signing-key material in the IdP's security boundary. Give the scheduler or operator task the privileges needed for rotation and record key IDs and outcomes in operational logs.

## Verification

With at least two replicas, stage a replacement and compare JWKS from both. Check that issuers keep using the current key while caches refresh, then verify that new tokens carry the new key ID and still-valid old tokens verify. Repeat with scheduler retries and rehearse rollback. Check the operator alert for a failed or stalled rotation.
