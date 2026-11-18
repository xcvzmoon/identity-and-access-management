# Browser UI reference

[Documentation index](README.md)

Nuxt builds the static browser UI. The Nitro IAM server serves the UI,
processes same-origin requests, and publishes the OIDC issuer.
[HTTP API reference](http-api.md)

## Pages and navigation

| Page                                                                                            | Access                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`/`](../apps/web/app/pages/index.vue)                                                          | Redirects to `/account`.                                              |
| [`/signin`](../apps/web/app/pages/signin.vue) and [`/signup`](../apps/web/app/pages/signup.vue) | Guest pages. A signed-in user is redirected to `/account`.            |
| [`/account`](../apps/web/app/pages/account.vue)                                                 | Requires a logged-in web session. Guests are redirected to `/signin`. |

The [global route middleware](../apps/web/app/middleware/auth.global.ts) reads the page's
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

Use one canonical origin for the UI, the API, and OIDC discovery. The
browser sends the Better Auth cookie to that origin. Use HTTPS in deployments
so Better Auth applies Secure cookies.

## Administration and OIDC pages

| Page                                                                           | Behavior                                                                                                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`/admin`](../apps/web/app/pages/admin.vue)                                    | Requires a session. Loads organization context, runs WebAuthn step-up, and opens administration panels for the selected organization and app. |
| [`/recover-password`](../apps/web/app/pages/recover-password.vue)              | Requests or redeems an account code. It shows a generic request confirmation.                                                                 |
| [`/oidc/login` and `/oidc/consent`](../apps/web/app/pages/oidc/%5Bstep%5D.vue) | Require signed interaction state. They show the registered app name and callback origin and submit forms to Nitro.                            |

The page route guard improves navigation. The Nitro API and Better Auth
plugins make the security decisions.

## Implementation map

| Module                                                                                                                                                                                                                                          | Responsibility                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`useUserSession()`](../apps/web/app/composables/use-user-session.ts)                                                                                                                                                                           | Loads and validates the reduced session response. Provides shared browser state for the route guard and account pages. |
| [`useAdminCollection()`](../apps/web/app/composables/use-admin-collection.ts)                                                                                                                                                                   | Loads paged admin collections for the selected scope and search.                                                       |
| [`useOrganizationInvitations()`](../apps/web/app/composables/use-organization-invitations.ts)                                                                                                                                                   | Loads invitation pages for the account or organization.                                                                |
| [`adminRequestMessage()`](../apps/web/app/utils/admin-request.ts)                                                                                                                                                                               | Maps known administration errors to visible messages.                                                                  |
| [Account invitations](../apps/web/app/components/account-invitations.vue)                                                                                                                                                                       | Displays and accepts invitations for the signed-in user.                                                               |
| [App access dashboard](../apps/web/app/components/admin/app-access-dashboard.vue) and [editor](../apps/web/app/components/admin/app-access-editor.vue)                                                                                          | Select installations and manage permission keys, roles, and assignments.                                               |
| [Credential panel](../apps/web/app/components/admin/application-credentials.vue)                                                                                                                                                                | Reads client and machine metadata and presents newly issued secrets once.                                              |
| [Member panel](../apps/web/app/components/admin/organization-members.vue), [ownership transfer](../apps/web/app/components/admin/ownership-transfer.vue), and [invitation panel](../apps/web/app/components/admin/organization-invitations.vue) | Manage member lifecycle in the selected organization.                                                                  |
| [Form input](../apps/web/app/components/form-input.vue), [layout](../apps/web/app/layouts/default.vue), and [styles](../apps/web/app/assets/css/main.css)                                                                                       | Shared input presentation, page layout, and styling.                                                                   |

[Admin contracts](management-api.md) · [Build flow](development.md#workspaces-and-output)
