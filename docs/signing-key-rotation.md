# IdP signing-key rotation

Apply the IdP migrations before upgrading the issuer processes. Complete the rollout across all replicas within the publication window. Every replica needs the same Better Auth secret and a connection to the same PostgreSQL primary.

## Timing and status

The first signing or JWKS request initializes the keyring. Each running issuer checks it at startup and every minute. Once the active RSA key is 90 days old, one issuer publishes an encrypted replacement under a PostgreSQL transaction lock. Clients can fetch its public key immediately. Signing moves to the replacement after one hour. Configure relying parties to refresh their JWKS within ten minutes (the installed jose remote JWKS default). The one-hour window allows several refresh opportunities. Confirm the maximum cache age with each external client before onboarding.

The former key stays published for 30 days after its last activation ends. The issuer's default access tokens live for one hour and its ID tokens for ten hours. Keep custom client token lifetimes plus clock tolerance below the retention period. The scheduler deletes retired keys after that period.

Query the primary for key IDs, transition times and the current state:

```sql
SELECT id, created_at, activate_after,
       CASE WHEN activate_after IS NOT NULL THEN 'staged'
            WHEN expires_at IS NULL THEN 'active'
            ELSE 'retired' END AS state,
       CASE WHEN activate_after IS NULL THEN expires_at END AS retired_at
FROM iam_idp.signing_keys
ORDER BY created_at DESC;
```

Route stderr events with `event=signing-key-rotation` and either `outcome=failed` or `outcome=rollback-failed` to the identity on-call. A failed transaction leaves the prior state intact. The next tick retries. Alert separately if a staged key remains past its activation time by more than two ticks or an active key is over 91 days old. Successful transition logs identify both key IDs. Compare the public JWKS from every issuer replica when investigating a missed transition.

## Roll back to a trusted key

Confirm the target was previously active, is still present in every replica's JWKS, and is trusted by the relying parties. From the matching source release, load the IdP runtime environment and run the following in `apps/idp/api`:

```sh
vpx scripts/rollback-signing-key.ts "$TRUSTED_KID"
```

Check the logged key IDs, obtain a fresh token, and verify its signature and `kid`. Rollback discards a pending replacement and starts the displaced active key's retention period. A restored key older than 90 days triggers publication of a fresh replacement on the next tick.

## Respond to a compromised key

Suspend issuance and tell relying parties to reject the affected `kid` immediately, including tokens validated from a cached JWKS. Keep a record of the affected key IDs and the exposure window. Restore a trusted retained key with the rollback command. With issuance still suspended, delete the compromised entry by its exact ID on the primary. Confirm every replica omits it from JWKS, flush verifier caches, and verify a new token against the trusted key before resuming issuance.

If there is no trusted retained key, stop all replicas, remove the compromised keyring under incident control, then start an isolated issuer and request JWKS to bootstrap a new key. Distribute and verify that JWKS before reopening traffic. If the database or Better Auth secret was exposed, treat every accessible private key as compromised and recover the issuer and its credentials before issuing replacement keys.
