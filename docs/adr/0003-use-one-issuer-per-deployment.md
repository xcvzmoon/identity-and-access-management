# Use one issuer per deployment

All organizations in a deployment share one OIDC issuer. A user who belongs to several organizations can reuse one IAM sign-in session. Membership and grants belong to the organization. Each organization switch checks the user's access to the destination organization.
