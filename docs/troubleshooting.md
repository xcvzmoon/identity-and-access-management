# Troubleshoot IAM

[Documentation index](README.md)

## Common setup failures

| Symptom                                  | Check                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL reports `3D000`               | Check `DB_DATABASE` and the migration role's database creation privileges. [Migrations](database-operations.md#schema-and-migrations)      |
| The container exits on startup           | Run `vp run docker logs`. Check the auth and database environment settings.                                                                |
| Sign-in redirects back to the login page | Check the public origin, the session cookie, and email verification. [Browser session and cookies](browser.md#browser-session-and-cookies) |
| The API returns `401`, `403`, or `503`   | Look up the status and response code. [Authentication responses](http-api.md#authentication-responses)                                     |

## Identity and administration

| Symptom                                                    | Check                                                                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The signup page reports success and email never arrives    | Check relay configuration, the account's eligibility, and the five-minute delivery cooldown. The response is generic. See [account lifecycle](identity.md#account-states-and-email-privacy).         |
| A correct password gets a generic denial                   | Check that the user finished email verification. Use [account recovery](account.md) when they need a new password.                                                                                   |
| An admin operation returns `PASSKEY_REQUIRED`              | Verify the passkey on the issuer origin again. Privileged actions use a five-minute window. Role changes can clear earlier verification.                                                             |
| An app or member is absent from admin search               | Check the selected organization and installation, the actor's role, and the target member's verification and suspension state. See [admin collections](management-api.md#administrator-collections). |
| A credential operation returns `CLIENT_CREDENTIAL_CHANGED` | Reload the panel and confirm the current credential version before retrying.                                                                                                                         |
| A built page still displays the old UI                     | Rebuild Nuxt and then Nitro, or run the root build. Restart the process with the new Nitro output.                                                                                                   |

## OIDC and machine access

| Symptom                                                  | Check                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery returns `503` or advertises an unexpected host | Check the issuer settings and the host and scheme delivered by the trusted ingress.                                                                                 |
| The browser never returns to the app                     | Check the exact HTTPS callback, the client ID, and the validity of hosted request state. Restart from the app to get fresh state.                                   |
| Code exchange returns `invalid_grant`                    | Check the SDK's verifier and exact callback, and whether an assignment revocation, credential change, or prior exchange invalidated the code.                       |
| Introspection returns `active: false`                    | Check the active client, IAM session, verified user, membership, and assignment. Use a fresh app sign-in after access is restored.                                  |
| Introspection is active and the app denies an operation  | Check the required permission in the live response and object-level access in the app.                                                                              |
| A machine lookup fails                                   | Use the current key and check expiry, quota, and installation status. See [machine access](integrate-app.md#machine-access).                                        |
| Only one replica has failures                            | Compare secret versions, issuer settings, ingress behavior, and the database target. Run the [replica check](pilot.md#pilot-replica-check) in a disposable fixture. |
