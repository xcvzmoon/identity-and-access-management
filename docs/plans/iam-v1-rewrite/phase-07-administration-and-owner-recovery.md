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
