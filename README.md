# Identity and Access Management

IAM v1 is an OpenID Connect (OIDC) issuer for organization-owned applications.
The IdP will host sign-in, issue tokens, and enforce app grants. The console
will use the IdP for sign-in and manage accounts, organizations, and app access.

The repository contains the IdP and console scaffolds. Each has a Nuxt web
workspace and a Nitro API workspace. Better Auth passed the engine evaluation.
The implementation plan tracks what remains before the external pilot.

| Goal                                       | Where to start                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Find a workspace or see who owns a feature | [Target monorepo structure](docs/architecture.md#target-monorepo-structure) |
| Run the four workspaces locally            | [Local setup](docs/local.md)                                                |
| See what ships in v1                       | [Launch scope](docs/rewrite-scope.md)                                       |
| Follow the rewrite                         | [Implementation plan](docs/plans/iam-v1-rewrite/overview.md)                |
| Reproduce the Better Auth evaluation       | [Evaluation evidence](docs/plans/iam-v1-rewrite/better-auth-evaluation.md)  |

[Documentation index](docs/README.md)
