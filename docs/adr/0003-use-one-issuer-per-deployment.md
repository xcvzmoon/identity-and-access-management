# Use one issuer per deployment

All customer organizations in an IAM deployment share one OIDC issuer, so a user who belongs to several organizations can reuse one sign-in session. Membership and app grants remain scoped to their organization. Switching organizations requires checking the user's access in the target organization.
