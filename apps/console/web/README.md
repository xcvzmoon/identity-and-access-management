# Console web

`@iam/console-web` is the Nuxt frontend for account and organization management. Verified users can open `/account`. The `/management` page exposes organization and application actions according to membership, role, and recent passkey verification. The console API handles OIDC and owns the console session.

Run `vp -C apps/console/web run dev` from the repository root to work on the frontend. Nuxt listens on port 3001. Use the console HTTPS origin for sign-in and management. Its ingress sends `/api/*`, including the OIDC callback, to the console API.

Build with `vp -C apps/console/web run build`. Nuxt writes the server bundle to `apps/console/web/.output/`.

[Local HTTPS setup](../../../docs/local.md#docker-with-portless) · [Console sign-in](../../../docs/local.md#sign-in-to-the-console) · [Validation](../../../docs/validation.md)
