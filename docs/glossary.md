# IAM glossary

[Documentation index](README.md)

| Term                     | Meaning in IAM                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Identity                 | The user account and its stable IAM user ID.                                                                            |
| Identity provider (IdP)  | The IAM service responsible for authenticating users and issuing tokens to registered apps.                             |
| Console                  | The IAM web app for managing accounts, organizations, app registrations, and access grants.                             |
| Verified email           | An email address whose ownership the user proved with the account code flow.                                            |
| Session                  | A PostgreSQL record for an authenticated IAM browser. An HTTP-only cookie identifies the session.                       |
| SSO session              | The user's session with the IdP that registered apps can reuse during sign-in.                                          |
| Application session      | A user's session with a specific app, established after sign-in.                                                        |
| App sign-out             | Ending the user's session in one app.                                                                                   |
| IAM sign-out             | Ending the user's current SSO session with the IdP.                                                                     |
| Tenant                   | The organization boundary for membership, management authority, and private installations.                              |
| Membership               | A link between a user and one organization. It has its own ID, role, and suspension state.                              |
| Organization invitation  | An admin's offer of organization membership to a person with a specific email address.                                  |
| Organization role        | `owner`, `admin`, or `member`. The role governs organization management.                                                |
| Application              | The registration owned by an organization, including its permission catalog.                                            |
| Installation             | The private deployment scope for an app, tied to the owning organization.                                               |
| Assignment or app grant  | A member's access to an installation. Its current roles determine product permissions.                                  |
| Permission catalog       | The set of product permission keys defined for an application.                                                          |
| Installation role        | A named set of app permissions that can be assigned within one installation.                                            |
| RBAC                     | Role-based access control. IAM checks organization roles for management and installation roles for product permissions. |
| Grant version            | A binding derived from the assignment and OAuth client credential versions. An earlier binding can become stale.        |
| Issuer                   | The canonical IAM origin advertised by discovery and used in tokens.                                                    |
| OIDC                     | OpenID Connect, the identity protocol apps use for hosted IAM sign-in.                                                  |
| Confidential client      | A server-side OAuth client that can protect its client secret.                                                          |
| Authorization code       | A short-lived value the SDK exchanges at the token endpoint with a PKCE verifier and client authentication.             |
| Callback or redirect URI | The exact pre-registered HTTPS URL that receives the authorization response.                                            |
| PKCE                     | Proof Key for Code Exchange. The client sends an S256 challenge and then proves possession of the verifier.             |
| State                    | A client value used to bind an authorization response to its initiating request.                                        |
| Nonce                    | A client value checked against the ID token to bind it to the sign-in request.                                          |
| Consent                  | The user's decision to authorize an application. IAM ties consent to the current app grant version.                     |
| ID token                 | A signed OIDC token that the app uses as proof of sign-in.                                                              |
| Access token             | A credential that IAM can validate for UserInfo and introspection, or invalidate through revocation.                    |
| Introspection            | A server-side token status check. IAM includes current product permissions in active responses.                         |
| UserInfo                 | The OIDC endpoint that returns the subject `sub` for a current IAM access token.                                        |
| JWKS and `kid`           | The JSON Web Key Set publishes public signing keys. A key ID identifies an individual key.                              |
| Passkey and step-up      | A WebAuthn credential and the extra verification required before sensitive administration.                              |
| Machine principal        | An installation-scoped identity for an app backend. A machine key authenticates this principal.                         |
| Runtime role             | The restricted PostgreSQL login the API uses to connect.                                                                |
| Migration owner          | The PostgreSQL role that owns schema changes and grants runtime privileges.                                             |

[OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html) ·
[PKCE](https://www.rfc-editor.org/rfc/rfc7636.html) ·
[Token introspection](https://www.rfc-editor.org/rfc/rfc7662.html) ·
[Token revocation](https://www.rfc-editor.org/rfc/rfc7009.html)
