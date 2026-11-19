# IAM documentation

## V1 rewrite

| Document                                                                 | What it covers                                                    |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Architecture and target monorepo structure](architecture.md)            | The four workspaces, deployment boundaries, and feature ownership |
| [Launch scope](rewrite-scope.md)                                         | Account, app integration, sign-out, and pilot requirements        |
| [Implementation plan](plans/iam-v1-rewrite/overview.md)                  | Phase status, dependencies, and acceptance checks                 |
| [Better Auth evaluation](plans/iam-v1-rewrite/better-auth-evaluation.md) | Engine decision, observed results, and reproduction commands      |
| [Local setup](local.md)                                                  | Start the Nuxt and Nitro workspaces                               |
| [Workspace reference](development.md)                                    | Package names, scripts, and build outputs                         |
| [Validation](validation.md)                                              | Current workspace checks and planned integration coverage         |
| [Pilot deployment](pilot.md)                                             | Configure ingress, deploy the replicas, and rehearse recovery     |
| [Client integration](client-integration.md)                              | Register a confidential client and authorize protected requests   |
| [Glossary](glossary.md)                                                  | Terms used in the rewrite                                         |

### Rewrite decisions

- [IAM owns the OIDC issuer](adr/0001-iam-owns-the-oidc-issuer.md)
- [Operate the OIDC engine](adr/0002-operate-the-oidc-engine.md)
- [Use one issuer per deployment](adr/0003-use-one-issuer-per-deployment.md)
- [Check app grants live](adr/0004-check-app-grants-live.md)
- [Register one OAuth client per app installation](adr/0005-register-one-client-per-installation.md)
