# Operate IdP signing keys

Apply the IdP migrations before upgrading the issuer processes. Complete the rollout across all replicas within the publication window. Every replica needs the same Better Auth secret and a connection to the same PostgreSQL primary.

## Monitor publication and activation

The first signing or JWKS request initializes the keyring. Each replica checks it at startup and every minute. Once the active RSA key reaches 90 days, a replica stages a replacement under a PostgreSQL transaction lock. The private key is encrypted at rest and the public key appears in JWKS immediately. The issuer activates it one hour later. Configure relying parties to refresh their JWKS within ten minutes (the installed jose remote JWKS default). The one-hour window allows several refresh opportunities. Confirm the maximum cache age with each external client before onboarding.

JWKS retains a retired public key for 30 days after its last activation ends. The issuer's default access tokens live for one hour and its ID tokens for ten hours. Keep custom client token lifetimes plus clock tolerance below the retention period. The scheduler deletes retired keys after that period.

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

After the first JWKS request initializes the keyring, run [check-signing-key-rotation.sh](../apps/idp/api/scripts/check-signing-key-rotation.sh) every minute from a monitoring host with `psql` and libpq settings for the primary. Use a dedicated monitoring login. A DBA can grant it the four metadata columns the check reads:

```sql
GRANT USAGE ON SCHEMA iam_idp TO iam_key_monitor;
GRANT SELECT (alg, created_at, activate_after, expires_at)
  ON iam_idp.signing_keys TO iam_key_monitor;
```

Route exit 2 to the identity on-call for a missing active signer or a missed transition. Exit 3 means monitoring lost visibility, including when the connection reaches a standby. Exit 0 clears the alert. During commissioning, verify alert delivery and recovery against a disposable issuer before enabling the production check.

## Restore a trusted signer

Confirm the target was previously active, is still present in every replica's JWKS, and is trusted by the relying parties. From the matching source release, load the IdP runtime environment and run the following in `apps/idp/api`:

```sh
vpx scripts/rollback-signing-key.ts "$TRUSTED_KID"
```

Check the logged key IDs, obtain a fresh token, and verify its signature and `kid`. Rollback discards a pending replacement and starts the displaced active key's retention period. A restored key older than 90 days triggers publication of a fresh replacement on the next tick.

## Respond to a compromised key

Suspend issuance and tell relying parties to reject the affected `kid` immediately, including tokens validated from a cached JWKS. Keep a record of the affected key IDs and the exposure window. Restore a trusted retained key with the rollback command. With issuance still suspended, delete the compromised entry by its exact ID on the primary. Confirm every replica omits it from JWKS, flush verifier caches, and verify a new token against the trusted key before resuming issuance.

If there is no trusted retained key, stop all replicas, remove the compromised keyring under incident control, then start an isolated issuer and request JWKS to bootstrap a new key. Distribute and verify that JWKS before reopening traffic. If the database or Better Auth secret was exposed, treat every accessible private key as compromised and recover the issuer and its credentials before issuing replacement keys.
