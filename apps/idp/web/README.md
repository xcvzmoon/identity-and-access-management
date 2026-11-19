# IdP web

`@iam/idp-web` is the Nuxt frontend for the IAM issuer. It hosts sign-in, invitation acceptance, email verification, password recovery, consent, IAM sign-out, passkey enrollment and verification, and operator workflows. The IdP API runs those operations and serves OIDC endpoints on the same origin.

Run `vp -C apps/idp/web run dev` from the repository root to work on the frontend. Nuxt defaults to port 3000. Use the HTTPS issuer for account and passkey flows. Its ingress sends `/api/*` and `/.well-known/*` to the IdP API and serves pages with Nuxt.

Build with `vp -C apps/idp/web run build`. Nuxt writes the server bundle to `apps/idp/web/.output/`.

[Local HTTPS setup](../../../docs/local.md#docker-with-portless) · [Hosted account flows](../../../docs/local.md#idp-account-flows) · [Validation](../../../docs/validation.md)
