# Phase 7. Move administration and owner recovery

[Implementation plan](overview.md)

## Changes

- Expose restricted IdP management operations for members, invitations, apps, installations, roles, and assignments. Use the authenticated user delegation proven in phase 1 and authorize every operation for the target organization at the IdP.
- Adapt console management pages to call that interface. Carry forward organization roles, run passkey ceremonies at the IdP origin, and verify recent step-up for sensitive operations at the IdP.
- Give IAM operators a restricted flow to create an organization and invite its first owner. Support passkey enrollment after verified acceptance and audited recovery when every owner loses the ability to complete step-up.

## Verification

Bootstrap a new organization from an operator invitation, enroll the owner's passkey, then register an app and grant access from the console. Exercise an ordinary member, an admin from a different tenant, a request without fresh step-up, and all owners locked out. Verify that recovery records the operator and affected organization.
