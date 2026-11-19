# Phase 3. Build invitation signup and recovery

[Implementation plan](overview.md)

## Changes

- Bind new account creation to an eligible organization invitation for the invited email. Let a matching verified user accept with their existing account.
- Move verified-email sign-in, password setup, and recovery to the IdP. Use protected email delivery and keep public responses generic where they could reveal whether an account exists.
- Add coverage for account and membership state transitions. Treat invite acceptance and the resulting membership as one operation so a retry cannot create a duplicate or consume an invitation without joining.

## Verification

Test new signup, existing-account acceptance, and password reset over the hosted flows. Try a wrong email, expired and replayed invitations, and direct signup routes without a valid invitation. Verify that the reset revokes the prior IAM sessions and that responses and logs preserve account privacy.
