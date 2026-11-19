# Browser UI reference

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md)

Web serves account and admin pages. IDP serves authentication pages
and calls the IAM API with credentials. The API and OIDC issuer use the web
origin. IDP uses a separate, same-site origin.
[HTTP API reference](http-api.md)

## Pages and navigation

| Page                                                                                                                                                                                                                                                                                                        | Access                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`/`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/pages/index.vue)                                                                                                                                                                | Redirects to `/account`.                                              |
| [`/signin`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/idp/app/pages/signin.vue) and [`/signup`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/idp/app/pages/signup.vue) | Guest pages. A signed-in user is redirected to `/account`.            |
| [`/account`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/pages/account.vue)                                                                                                                                                       | Requires a logged-in web session. Guests are redirected to `/signin`. |

The [global route middleware](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/middleware/auth.global.ts) reads the page's
`auth` metadata and the current `useUserSession()` state. A new account page
can opt into that routing behavior with `definePageMeta({ auth: 'user' })`.
Application API requests have their own authorization checks on the API.

The standalone sign-in, sign-up, account, admin, and password recovery pages
send `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Their
content security policy blocks framing and restricts form submissions to the
IAM origin.

## Sign-up, sign-in, and sign-out

| Same-origin endpoint        | Behavior                                                                          |
| --------------------------- | --------------------------------------------------------------------------------- |
| `POST /api/signup`          | Accept a name and email, then continue to email verification and password setup.  |
| `POST /api/signin`          | Submit credentials and set the Better Auth session cookie for a verified account. |
| `POST /api/signout`         | Revoke the Better Auth session and clear its cookie.                              |
| `GET /api/auth/get-session` | Return the current user or null and renew the session cookie when needed.         |

The Nitro routes validate the request origin and return authentication
responses with `Cache-Control: no-store`. Signup returns the same response
for new and existing addresses. The API returns a generic credential denial
for unknown or unverified accounts and invalid passwords.

## Browser session and cookies

The browser uses the HTTP-only Better Auth cookie on the IAM origin.
The route middleware checks `/api/auth/get-session` before opening protected
pages. The static HTML shell contains no account information. The API
enforces authentication and tenant permissions for every protected operation.

### Cookies and origins

The API sets a host-only Better Auth cookie on the web hostname. The browser
sends it to that host during IDP sign-in and when opening web pages. Use
HTTPS and same-site web and IDP hostnames in production.

## Administration and OIDC pages

| Page                                                                                                                                                                                 | Behavior                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`/admin`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/pages/admin.vue)                                    | Requires a session. Loads organization context, runs WebAuthn step-up, and opens administration panels for the selected organization and app. |
| [`/recover-password`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/idp/app/pages/recover-password.vue)              | Requests or redeems an account code. It shows a generic request confirmation.                                                                 |
| [`/oidc/login` and `/oidc/consent`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/idp/app/pages/oidc/%5Bstep%5D.vue) | Require signed interaction state. They show the registered app name and callback origin and submit forms to Nitro.                            |

The page route guard improves navigation. The Nitro API and Better Auth
plugins make the security decisions.

## Implementation map

| Module                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Responsibility                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`useUserSession()`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/composables/use-user-session.ts)                                                                                                                                                                                                                                                                                                                                                                                       | Loads and validates the reduced session response. Provides shared browser state for the route guard and account pages. |
| [`useAdminCollection()`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/composables/use-admin-collection.ts)                                                                                                                                                                                                                                                                                                                                                                               | Loads paged admin collections for the selected scope and search.                                                       |
| [`useOrganizationInvitations()`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/composables/use-organization-invitations.ts)                                                                                                                                                                                                                                                                                                                                                               | Loads invitation pages for the account or organization.                                                                |
| [`adminRequestMessage()`](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/utils/admin-request.ts)                                                                                                                                                                                                                                                                                                                                                                                           | Maps known administration errors to visible messages.                                                                  |
| [Account invitations](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/account-invitations.vue)                                                                                                                                                                                                                                                                                                                                                                                   | Displays and accepts invitations for the signed-in user.                                                               |
| [App access dashboard](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/app-access-dashboard.vue) and [editor](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/app-access-editor.vue)                                                                                                                                                                                                | Select installations and manage permission keys, roles, and assignments.                                               |
| [Credential panel](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/application-credentials.vue)                                                                                                                                                                                                                                                                                                                                                                            | Reads client and machine metadata and presents newly issued secrets once.                                              |
| [Member panel](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/organization-members.vue), [ownership transfer](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/ownership-transfer.vue), and [invitation panel](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/admin/organization-invitations.vue) | Manage member lifecycle in the selected organization.                                                                  |
| [Form input](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/components/form-input.vue), [layout](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/layouts/default.vue), and [styles](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/app/assets/css/main.css)                                                                                       | Shared input presentation, page layout, and styling.                                                                   |

[Admin contracts](management-api.md) · [Build flow](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/development.md#workspaces-and-output)
