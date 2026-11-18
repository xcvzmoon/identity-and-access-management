# IAM documentation

IAM is an identity provider for organization-owned applications. An application
can send users to the IAM sign-in page over OpenID Connect (OIDC). Organization
admins decide who can use each app and which app permissions each member gets.

## Understand the system

| Document                                      | What you can learn                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| [Reviewer guide](review.md)                   | Review order, security invariants, and where tests cover them                    |
| [Architecture](architecture.md)               | Deployment topology, trust boundaries, and request dispatch                      |
| [Identity and account lifecycle](identity.md) | Signup, email codes, sign-in, sessions, and admin passkeys                       |
| [Application access](application-access.md)   | Tenant isolation, app roles, the OIDC exchange, credential types, and revocation |
| [Glossary](glossary.md)                       | IAM, database, and protocol terms used in the docs                               |

## Learn by doing

[Connect your first private application](first-app.md) with the reference
client. Grant a role and see how a permission change takes effect.

## Use and operate IAM

| Task                                                          | Guide                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Start a local service or container                            | [Run IAM locally](local.md)                                         |
| Verify an email or reset a password                           | [Recover an account](account.md)                                    |
| Invite members, register an app, or change permissions        | [Manage organizations and apps](administer.md)                      |
| Connect an OIDC client or a machine                           | [Integrate an application](integrate-app.md)                        |
| Configure the issuer, ingress, and logging                    | [Deploy IAM](deployment.md)                                         |
| Check a pilot, contain a client, or rotate a signing key      | [Pilot and signing key operations](pilot.md)                        |
| Apply migrations, grant runtime access, or restore a database | [PostgreSQL operations](database-operations.md)                     |
| Monitor activity, expire records, or delete an account        | [Audit and deletion](privacy-operations.md)                         |
| Build, test, or diagnose the service                          | [Validation](validation.md) · [Troubleshooting](troubleshooting.md) |

## Reference

| Document                                            | What you can look up                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| [HTTP API](http-api.md)                             | Route and method allowlist, request controls, response status, and audit fields |
| [Administration and account API](management-api.md) | JSON actions, input fields, response shapes, and actor requirements             |
| [Browser UI](browser.md)                            | Pages, route guards, component and composable responsibilities                  |
| [Auth package](auth-package.md)                     | Exports, policy modules, key settings, and credential rules                     |
| [Database](database.md)                             | Connection settings, schema, access functions, and migration history            |
| [Shared package](shared-package.md)                 | Auth row schemas, environment validation, and import paths                      |
| [Workspace](development.md)                         | Build order, scripts, tests, lint rules, and release configuration              |
