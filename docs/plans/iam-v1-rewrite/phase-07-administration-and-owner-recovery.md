# Phase 7. Build administration and owner recovery

[Implementation plan](overview.md)

## Changes

- Implement restricted management operations in `apps/idp/api` for
  organizations, members, invitations, app registrations, installations,
  roles, and assignments. Authorize every operation for the acting user
  and target organization.
- Build management pages in `apps/console/web`. Use `apps/console/api` to
  call the IdP management interface with the authenticated user context
  proven in Phase 1.
- Run passkey enrollment and challenges on the IdP origin. Require fresh
  step-up for protected actions and bind it to the acting user's current
  IAM session.
- Provide a restricted operator workflow to create an organization and
  invite its first owner. Let the owner enroll a passkey after verified
  acceptance. If every owner loses the ability to complete step-up,
  require operator verification and record the recovery action.

## Verification

Bootstrap an organization with an operator invitation. Enroll the
owner's passkey, register an app, and assign roles through the console.
Check denial for ordinary members, admins of another organization, and
requests without step-up for the current session. Exercise a locked-out
organization recovery and verify the audit record identifies the
operator, affected organization, timestamp, and outcome.

## Results

Chromium completed operator onboarding and verified owner acceptance using
a delivered email link. The owner enrolled a virtual WebAuthn authenticator
on the IdP origin, registered an app in the console, defined a role, and
assigned it. The console displayed the assignment after rereading it from
the IdP.

The IdP denied mutations by ordinary members and administrators outside the
target organization. It denied mutations when verification was absent,
expired, or attached to another IAM session. A separate regression test
confirmed that a challenge issued to one session could not elevate another
session for the same user.

After the fixture removed the owner's virtual authenticator, the operator
issued a replacement invitation. The replacement owner accepted and enrolled
a new passkey. PostgreSQL contained one recovery record for the case with
the operator, organization, timestamp, and invitation outcome. A duplicate
submission was rejected.

The live Phase 3–5 regression fixtures passed. The Phase 6 console sign-in
fixture timed out during a concurrent run and passed when rerun independently.
[Run the Phase 7 fixtures](../../validation.md#administration-and-owner-recovery)
