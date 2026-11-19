# Identity and account lifecycle

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

An IAM identity can belong to several organizations. An authenticated IAM
session identifies the user across hosted pages. Membership, app assignment,
and recent passkey verification govern separate operations.

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md) · [Account instructions](account.md) ·
[Auth policy reference](auth-package.md#credential-and-session-policies)

## Account states and email privacy

The hosted signup route accepts a name and an email. It supplies a random
initial credential to Better Auth. The direct email signup endpoint accepts a
password in the body. Both paths return an empty JSON object on accepted
signup and issue no session cookie. The public response has the same shape
when the address is already registered. The verification flag is required
before either sign-in path can create a usable session.

Password recovery also handles first-time email verification. For a valid
request, the response is generic. The API reserves an email delivery window
and issues a code for an eligible credential account. An eight-digit code is
valid for five minutes, has a three-attempt limit, and is stored as a keyed
hash. The request quota is ten per client IP per five minutes. The delivery
window is one code per account per five minutes. SMTP delivery is handled
outside the public response. Successful redemption consumes the code, sets
the password, verifies the email, and revokes the user's existing sessions.
The user then signs in with the new password.

Unknown emails, incorrect passwords, and unverified accounts receive a
generic credential denial for both ordinary IAM sign-in and hosted OIDC login.
Privacy regression tests check public behavior. The service can still
distinguish legitimate state changes in restricted audit records.

[Account API contracts](management-api.md#account-actions) ·
[Authentication audit](http-api.md#authentication-audit-events)

## Session lifecycle

Better Auth keeps sessions in PostgreSQL. A sign-in response sets the IAM
cookie on the issuer origin. Session lookup may renew the cookie. The hosted
UI reads a reduced session view. Nitro forwards renewal and clearing headers
to the browser. The IAM sign-out endpoint revokes the
current session. Live app token checks require a current IAM session for the
token's subject, so they also reflect sign-out and password reset.

The IAM browser session and a registered application's local session have
different cookies. The app controls its local logout and can revoke the app
access token. The same IAM session can authorize another sign-in when the
current app grant and consent allow it.

[Browser session behavior](browser.md#browser-session-and-cookies) ·
[Application authorization](application-access.md#live-access-checks)

## Administrator step-up

A verified organization owner or admin can open the administration page. The
initial passkey enrollment requires the current password. Subsequent
enrollment requires recent passkey verification. WebAuthn binds the ceremony
to the issuer origin and requires user verification. The server rotates the
session after a successful assertion and records a verification time for the
new session. The administrative window is five minutes.

Admin handlers validate verified identity, active membership, role, and
recent verification before privileged actions. The role requirement depends
on the action. For example, machine key management and ownership transfer
require the owner. A role promotion or demotion clears the target's recent
verification. Ownership transfer clears it for both affected accounts.

[Admin actions](management-api.md#administrator-interaction) ·
[Organization procedures](administer.md)

## Code paths

| Policy                                           | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted signup and sign-in response shaping       | [Browser auth](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/api/server/utils/browser-auth.ts) · [Auth response dispatch](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/api/server/utils/auth-http.ts)                                                                                                                                                                                  |
| Recovery eligibility, cooldown, and code storage | [Recovery plugin](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/password-recovery.ts) · [Email reservation](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/account-email-rate.ts) · [Code plugin](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/account-otp.ts) |
| SMTP delivery                                    | [Account and invitation mail](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/account-email.ts)                                                                                                                                                                                                                                                                                                                                        |
| Passkey ceremonies and verification window       | [Admin passkeys](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/admin-passkeys.ts)                                                                                                                                                                                                                                                                                                                                                    |
| Session and role checks for privileged requests  | [Organization admin policy](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/organization-admin.ts) · [Admin interaction](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/admin-interaction.ts)                                                                                                                                                        |
