# Operate the OIDC engine

For v1, IAM will run an established OpenID Connect implementation on infrastructure we operate. This gives us control over deployment and authorization policy while reusing the protocol implementation. We own upgrades, availability, and on-call response for the engine.

Use Better Auth as the v1 engine. Version `1.7.26` passed the application proof and the selected OpenID Foundation discovery and PKCE modules. Better Auth owns the protocol handlers. IAM owns invitation eligibility, per-installation authorization, live grant checks, and signing-key activation. [Evaluation evidence](../plans/iam-v1-rewrite/better-auth-evaluation.md)
