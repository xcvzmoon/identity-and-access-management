# Operate the OIDC engine

For v1, IAM will run an established OpenID Connect implementation on infrastructure we operate. This gives us control over deployment and authorization policy while reusing the protocol implementation. We own upgrades, availability, and on-call response for the engine.

Better Auth is the first candidate. The evaluation must demonstrate invitation signup, console OIDC sign-in, tenant-scoped grants, live revocation, and JWKS rotation before we commit to it.
