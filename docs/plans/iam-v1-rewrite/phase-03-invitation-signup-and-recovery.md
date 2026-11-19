# Phase 3. Build invitation signup and recovery

[Implementation plan](overview.md)

## Changes

- Add hosted sign-in, email verification, invitation signup, and password
  recovery in `apps/idp/web`. Handle account operations and email delivery
  with Better Auth and IAM invitation policy in `apps/idp/api`.
- Verify the Better Auth adapter with the API's selected PostgreSQL driver
  and pinned Drizzle RC. The Phase 1 Drizzle proof used the `pg` driver.
- Bind signup to an eligible organization invitation and its email address.
  Allow a matching verified account to accept the invitation. Commit
  acceptance and membership creation together so retries preserve both.
- Seed an organization and a redeemable invitation in a disposable
  fixture. Use test email delivery to exercise the real flows. Production
  first-owner provisioning is part of Phase 7.
- Use generic responses where password recovery or verification requests
  could reveal whether an account exists. Revoke existing IAM sessions
  when a password reset succeeds.

## Verification

Use a browser to accept an invitation as a new user and as a matching
verified user. Check membership, email verification, and sign-in. Exercise
direct signup, wrong-email acceptance, expiry, replay, and concurrent
acceptance. Reset a password and verify the old password, reset link, and
IAM sessions can no longer be used. Check account privacy in responses
and logs.
