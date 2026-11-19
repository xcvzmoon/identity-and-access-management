# Manage organizations and applications

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md)

## Register an app

Sign in as an owner or administrator of an existing organization. Open
`/admin` and complete passkey verification. Select the organization and
enter the application name and exact HTTPS callback. Keep the default
HTTP Basic authentication method unless the app SDK requires POST body
authentication. Save the client secret in the app server before leaving
the registration result.

Registration creates a private app and its installation. Grant access to
a member before starting an OIDC sign-in. [First app tutorial](first-app.md) ·
[Application integration](integrate-app.md)

## Organization invitations

In `/admin`, verify your passkey and select the organization. Owners and
admins can invite a member by email and cancel pending invitations.
Invitations expire after 48 hours. The configured SMTP relay sends a notice
with a link to the IAM account page. If delivery fails, the invitation is
still available from that page.

The recipient signs in with the invited email, verifies it, and accepts the
invitation from `/account`. This grants regular organization membership.
An organization admin can then assign the member access and roles in each
private app they should use.

## Member suspension

After verifying a passkey in `/admin`, open **Organization members** and
select a regular member to suspend or reinstate. Suspension blocks app access
in that organization immediately on live token checks. Reinstatement retains
the member’s existing assignments and requires a new app sign-in. App tokens
and authorization codes issued before suspension stay invalid. The member can
still sign in to IAM and use apps in their other organizations.

## Transfer ownership

An owner can verify a passkey in `/admin`, select the organization, and
choose **Transfer ownership**. Select an active member or admin with a
verified email. Confirm the recipient’s name and email before submitting.
IAM promotes the recipient and changes the outgoing owner to admin in one
transaction. Both accounts must verify a passkey again for admin work.
Existing app assignments stay in effect.

## Delegate administrator access

An owner can verify a passkey in `/admin` and use **Organization members**
to make an active, email-verified member an administrator or remove an
administrator’s role. Promotion and demotion clear the affected account’s
previous admin passkey verification. App assignments are separate from the
organization role and stay in effect.

## Administrator access

Sign in to IAM and open `/admin`. A verified organization owner or admin
can register an app after verifying a passkey. First enrollment requires
the current password. Verify an existing passkey before adding a backup passkey.
The WebAuthn ceremony is tied to the IAM origin and requires device verification.
A successful assertion rotates the IAM session and grants five minutes of
administrative access. Use HTTPS on the canonical IAM origin outside loopback
development.

Registration defaults to HTTP Basic (`client_secret_basic`). Choose **POST
body** only when the integration needs it. To select it in a same-origin
`register-app` request to `POST /api/auth/admin/interaction`, set
`tokenEndpointAuthMethod` to `client_secret_post`. Configure the SDK to use the
registered method for token requests, introspection, and revocation. For POST
body authentication, exclude these request bodies from proxy and telemetry logs
because they contain the client secret. [OAuth 2.0 client password rules](https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1)

The same-origin `POST /api/auth/admin/interaction` endpoint also supports
server-validated browser management actions `manage-client` and
`manage-machine-key`. Supply `clientId` and `operation` for client disablement
or secret rotation. Supply `change` with `action` and `installationId` for
machine key issuance, plus `keyId` for rotation or revocation. Existing
organization authorization rules apply, including the owner requirement for
machine keys. The browser API requires a current verified IAM session and
returns new secrets once in a non-cacheable response.

## Credential management

Verify your passkey, select an app in `/admin`, and open **Credential
management**. Owners and admins can rotate its OAuth client secret or disable
the client. Only owners can issue, rotate, or revoke the installation’s machine
key. The panel shows client status and machine key expiry. New secrets appear
once after issuance or rotation. Store them in the app server’s secret store
before dismissing the result or leaving the panel.

The panel reads metadata from the `credentials` collection on
`POST /api/auth/admin/access`. Send its `installationId`. For client changes,
pass the displayed `credentialVersion` as `expectedVersion` to reject a stale
change after another admin has rotated the credential.

## Replace an OAuth callback

Open **Edit callback** for an enabled client in **Credential management**.
Enter one exact HTTPS URL and review it before confirming. The replacement
invalidates current access tokens and outstanding authorization codes. The
current client secret stays valid. The app must use the new URL when it
starts sign-in and exchanges a code.

The same admin interaction endpoint accepts `replace-callback` with
`clientId`, `expectedVersion`, and `redirectUri`. A saved replacement records
an audit event with the client identifier. Reload credential status if an
earlier rotation or callback change makes the version stale.

## Application permissions and assignments

In `/admin`, verify your passkey and choose the owning organization and app.
Add permission keys before assigning them to a role. Search for eligible
members by name or email, then choose their roles or revoke app access.

For API clients within the IAM frontend, the same-origin
`POST /api/auth/admin/access` endpoint lists `apps`, `permissions`, `roles`, or
`members` using the `collection` field. Send the `organizationId` for `apps`
and the `installationId` for the other collections. Member lists accept an
optional `search`. Send the returned `nextCursor` as `cursor` to load more
results for the same collection and search. These reads require a recent
passkey check and return only records from an organization you administer.

For writes, use `POST /api/auth/admin/interaction`. Send the
`installationId` returned by app registration. For assignments, use the member
ID from the owning organization. Each change is attributed to the signed-in
administrator and recorded in the app access audit log.

| Action                 | Additional request fields                         | Effect                                                                                                                                                              |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register-permissions` | `permissionKeys`                                  | Adds keys to this app's permission catalog.                                                                                                                         |
| `save-role`            | `role: { key, permissionKeys }`                   | Creates an installation role or replaces its complete permission set. Each key must already be in this app's catalog.                                               |
| `change-assignment`    | `change: { action: 'grant', memberId, roleKeys }` | Grants an active, verified organization member access or replaces their complete role set. An empty role list allows sign-in without granting a product permission. |
| `change-assignment`    | `change: { action: 'revoke', memberId }`          | Revokes the assignment. Live introspection rejects access tokens tied to the revoked grant.                                                                         |

An organization owner or admin can manage its installations. Organization
administration alone grants no app access. Role keys can repeat across apps,
and their permissions and assignments are evaluated within each installation.
