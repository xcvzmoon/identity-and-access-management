# Identity and Access Management

IAM v1 is an OpenID Connect (OIDC) issuer for organization-owned applications. The identity provider (IdP) hosts sign-in, invitation signup, password recovery, and consent. It issues tokens to registered applications and checks current access on protected requests. The console uses the issuer for sign-in and gives verified users an account page. Organization owners and administrators manage membership and app access through the console.

## Get started

1. Install the workspace dependencies with `vp install`.
2. Run the Docker stack with Portless for named HTTPS origins. [Local setup](docs/local.md#docker-with-portless)
3. Provision an operator and the console client, then sign in at `/account` on the console origin. [Console provisioning](docs/pilot.md#provision-the-console-client)

## Find your workspace

| Workspace                                 | Responsibility                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| [IdP web](apps/idp/web/README.md)         | Hosted account, consent, passkey, and operator pages                   |
| [IdP API](apps/idp/api)                   | Identity, SSO, OIDC, organizations, grants, signing keys, and audit    |
| [Console web](apps/console/web/README.md) | Account and organization management pages                              |
| [Console API](apps/console/api)           | Console OIDC client, application sessions, and calls to IdP management |

[Documentation](docs/README.md) · [Project history](docs/history.md) · [Repository conventions](AGENTS.md)
