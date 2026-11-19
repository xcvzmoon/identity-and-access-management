# Administration and account API

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

These JSON endpoints are on the IAM origin. Send a same-origin `Origin`
header and `Content-Type: application/json`. Session-bound actions use the IAM
session cookie. IDs for organizations, members, installations, keys, and
invitations are UUIDs. OAuth client IDs are a separate identifier.

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md) · [HTTP request rules](http-api.md#request-authorization)

## Account actions

| Route                                      | Request fields                                             | Result                                                                |
| ------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/signup`                         | `name`, `email`                                            | `{}` on accepted submission.                                          |
| `POST /api/signin`                         | `email`, `password`                                        | `{}` and the IAM session cookie on success.                           |
| `POST /api/signout`                        | No body required                                           | `{}` with the session cookie cleared on success.                      |
| `POST /api/auth/account/password-recovery` | `action: "request"`, `email`                               | `{ accepted: true }` for valid requests, including unknown addresses. |
| `POST /api/auth/account/password-recovery` | `action: "reset"`, `email`, eight-digit `code`, `password` | `{ reset: true }` on successful redemption.                           |

`GET /api/auth/get-session` and `POST /api/auth/get-session` return `null` or
`{ user: { id, email, name, emailVerified } }`. Forward the response's
`Set-Cookie` headers when proxying a request that updates or clears a session.

## Administrator interaction

Send one `action` to `POST /api/auth/admin/interaction`. The actor needs
a verified session and active management membership. Credential and app
changes require recent passkey verification and authority over the target
organization.

| Action                 | Additional fields                                                                 | Response or effect                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `context`              | None                                                                              | `organizations` with `id`, `name`, and `owner`, plus `enrolled` and `verified`.                                                                  |
| `begin-enrollment`     | `password`                                                                        | WebAuthn registration options.                                                                                                                   |
| `finish-enrollment`    | WebAuthn registration `response`                                                  | Stores the new credential.                                                                                                                       |
| `begin-verification`   | None                                                                              | WebAuthn authentication options.                                                                                                                 |
| `finish-verification`  | WebAuthn authentication `response`                                                | Rotates the session and records recent verification.                                                                                             |
| `register-app`         | `organizationId`, `name`, `redirectUri`, optional `tokenEndpointAuthMethod`       | `applicationId`, `installationId`, `clientId`, `clientSecret`, and `tokenEndpointAuthMethod`.                                                    |
| `manage-client`        | `clientId`, `operation: "disable" \| "rotate-secret"`, optional `expectedVersion` | `action`, plus `clientSecret` and `credentialVersion` for rotation.                                                                              |
| `replace-callback`     | `clientId`, `redirectUri`, `expectedVersion`                                      | `action`, `redirectUri`, and `credentialVersion`.                                                                                                |
| `manage-machine-key`   | `change: { action, installationId, keyId? }`                                      | Owner only. `issue` and `rotate` return `action`, `keyId`, `key`, and `expiresAt`. `revoke` returns `action`. Rotate and revoke require `keyId`. |
| `register-permissions` | `installationId`, `permissionKeys`                                                | Adds keys to the permission catalog.                                                                                                             |
| `save-role`            | `installationId`, `role: { key, permissionKeys }`                                 | Saves the full permission set for an installation role.                                                                                          |
| `change-assignment`    | `installationId`, `change: { action: "grant", memberId, roleKeys }`               | Grants access or replaces the full role set.                                                                                                     |
| `change-assignment`    | `installationId`, `change: { action: "revoke", memberId }`                        | Revokes the assignment.                                                                                                                          |

Permission and role keys start with a lowercase letter. Use lowercase
letters and digits, with single periods, underscores, or hyphens between
alphanumeric groups. A key has at most 100 characters. Each input key
list holds at most 100 items.

Use `credentialVersion` from the credential overview as `expectedVersion`.
A stale version produces `409` with `CLIENT_CREDENTIAL_CHANGED`. Newly
issued credentials appear in the creation or rotation response. Store them
before leaving the workflow.

## Administrator collections

Send a `collection` to `POST /api/auth/admin/access`. The actor needs a
verified session and recent passkey verification. The target organization
determines authority. Paginated results return `items` and `nextCursor`.
Reuse the cursor for the same collection, scope, and search. A null cursor
marks the end. Lists return up to 30 items. Search takes at most 150
characters. The `permissions` and `roles` cursors are keys. Other
collection cursors are UUIDs.

| Collection             | Required selector | Optional filters   | Contents                                                                                                                                                                                               |
| ---------------------- | ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps`                 | `organizationId`  | `cursor`           | `id` (installation ID), `name`.                                                                                                                                                                        |
| `permissions`          | `installationId`  | `cursor`           | `key` from the app catalog.                                                                                                                                                                            |
| `roles`                | `installationId`  | `cursor`           | `key`, `permissionKeys`.                                                                                                                                                                               |
| `members`              | `installationId`  | `cursor`, `search` | `id` (member ID), `name`, `email`, `assigned`, `roleKeys`.                                                                                                                                             |
| `organization-members` | `organizationId`  | `cursor`, `search` | `id`, `name`, `email`, `suspended`, `role`, `promotionEligible`.                                                                                                                                       |
| `ownership-candidates` | `organizationId`  | `cursor`, `search` | Same fields as `organization-members`. Owner-only view of eligible transfer targets.                                                                                                                   |
| `credentials`          | `installationId`  | None               | `clients` with `clientId`, `disabled`, `credentialVersion`, and `redirectUris`. `machine` is null for a non-owner. For an owner it contains `activeKey`, which is null or has `keyId` and `expiresAt`. |

## Membership and invitations

| Route                                     | Fields                                                          | Actor and response                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/admin/member-status`      | `organizationId`, `memberId`, `status: "suspended" \| "active"` | Verified manager with recent passkey check. Sets regular member status and returns `{ status, changed }`. |
| `POST /api/auth/admin/member-role`        | `organizationId`, `memberId`, `role: "admin" \| "member"`       | Owner with recent passkey check. Returns `{ role, changed }`.                                             |
| `POST /api/auth/admin/transfer-ownership` | `organizationId`, `memberId`                                    | Owner with recent passkey check. Returns `{ transferred: true }` on success.                              |

Send invitation actions to `POST /api/auth/account/organization-invitations`.
Invitees need the verified IAM identity for the invited address. Management
actions require recent passkey verification and organization authority.

| Action         | Additional fields                   | Result                                                               |
| -------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `list-mine`    | Optional `cursor`                   | Page of pending invitations for the account.                         |
| `accept`       | `invitationId`                      | Returns `organizationId` and `memberId` for the accepted membership. |
| `list-pending` | `organizationId`, optional `cursor` | Page of pending invitations for an administered organization.        |
| `invite`       | `organizationId`, `email`           | Returns `invitationId` and `notified` for the email notice result.   |
| `cancel`       | `organizationId`, `invitationId`    | `{ canceled: true }` on success.                                     |

[Admin interaction source](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/admin-interaction.ts) ·
[Collection source](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/admin-access.ts) ·
[Invitation source](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/packages/auth/src/utils/organization-invitations.ts)
