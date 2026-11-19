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
| [Glossary](glossary.md)                                                  | Terms used in the rewrite                                         |

### Rewrite decisions

- [IAM owns the OIDC issuer](adr/0001-iam-owns-the-oidc-issuer.md)
- [Operate the OIDC engine](adr/0002-operate-the-oidc-engine.md)
- [Use one issuer per deployment](adr/0003-use-one-issuer-per-deployment.md)
- [Check app grants live](adr/0004-check-app-grants-live.md)
- [Register one OAuth client per app installation](adr/0005-register-one-client-per-installation.md)

## POC reference

These guides describe the implementation retired before the rewrite scaffolds
were added. Use the POC revision to look up its routes, examples, and source.
[Last POC revision](https://github.com/xcvzmoon/identity-and-access-management/tree/31d96060a63a7613d10e7634a49c1822687c5381)

| Area                     | Historical guides                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System and request flows | [Review](review.md), [Identity](identity.md), [Application access](application-access.md), [HTTP API](http-api.md), [Browser UI](browser.md)                                      |
| Product workflows        | [Account recovery](account.md), [Administration](administer.md), [Management API](management-api.md), [First app tutorial](first-app.md), [App integration](integrate-app.md)     |
| Operations               | [Deployment](deployment.md), [Pilot](pilot.md), [Database operations](database-operations.md), [Privacy operations](privacy-operations.md), [Troubleshooting](troubleshooting.md) |
| Packages                 | [Auth](auth-package.md), [Database](database.md), [Shared](shared-package.md)                                                                                                     |
