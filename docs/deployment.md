# Deploy IAM

> **POC reference.** This guide documents the retired implementation. For the v1 rewrite, see the [current docs](README.md#v1-rewrite).

[Documentation index](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/docs/README.md)

## Deployment

Build with `vp run build` and deploy the `.output` directories from
`apps/api`, `apps/idp`, and `apps/web` to separate services. Each starts with
`node .output/server/index.mjs` from its own app directory. The
[Dockerfile](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/Dockerfile) also provides `api`, `idp`, and `web` targets.
Set `APP_ENV="production"` on the API.
Set `NUXT_API_URL` on IDP to the API's private HTTP or HTTPS origin.

1. Configure the migration role and a separate runtime login. Require TLS for
   both database connections. [Deployment roles](database-operations.md#deployment-roles) ·
   [PostgreSQL TLS](database.md#postgresql-tls-in-deployment)
2. Drain older replicas before running the migration that revokes unverified
   sessions. Apply pending migrations as the migration owner.
   [Session migration](http-api.md#authentication-routes)
3. Set `AUTH_URL` and `AUTH_WEB_ORIGIN` to the existing public web and issuer
   origin, for example `https://iam.example.com`. Set `AUTH_IDP_ORIGIN` on
   the API and `NUXT_IDP_ORIGIN` on web to the same IDP origin, for example
   `https://login.example.com`. Set `NUXT_PUBLIC_WEB_ORIGIN` on IDP to the
   web origin. Use HTTPS hostnames on the same site so browsers can send the
   API session cookie with IDP requests. The cookie is scoped to the API host.
   Share `AUTH_SECRET` across replicas. Configure the SMTP relay.
   [API configuration](http-api.md#configuration)
4. On the web hostname, route `/api`, `/api/*`, and
   `/.well-known/openid-configuration` to the API and other paths to web.
   Route the IDP hostname to the IDP service. Web redirects requests for auth
   pages to IDP. IDP calls the API on the web hostname.

   Configure ingress to replace incoming forwarding headers. Set
   `IAM_IDP_TRUSTED_PROXIES` to the ingress peer IPs and
   `IAM_API_TRUSTED_PROXIES` to the ingress and IDP peer IPs so the API
   can rate-limit OIDC page validation by client address. [Ingress and TLS](#tls-at-ingress)

5. Configure restricted audit collection and retention. Verify that ingress
   logs exclude credential and token values. [Ingress logging](#ingress-logging) ·
   [Authentication monitoring](http-api.md#monitor-authentication-outcomes) ·
   [Audit retention](privacy-operations.md#retain-and-expire-app-audit-events)

### Verify the pilot

Before routing pilot traffic, use staging and disposable test identities to
check the following behavior.

- Verify discovery over HTTPS. Complete a browser sign-in with a registered
  app and check that JWKS contains the key that signed the ID token.
  [Reference client](integrate-app.md#run-the-reference-client)
- Run the OIDC replica and conformance checks. Exercise separate app grants
  for a member of two organizations. Check that revocation blocks the next
  protected request. [Replica check](pilot.md#pilot-replica-check) ·
  [OpenID conformance](pilot.md#run-openid-conformance)
- Check signup and sign-in privacy, email verification, rate limits, and
  administrator passkey enforcement. Verify that the proxy supplies the
  correct client IP.
- Rehearse signing-key rotation and database recovery. Verify least-privilege
  access to the database and restricted audit records.
  [Key rotation](pilot.md#rotate-the-issuer-signing-key) ·
  [Backup and restore](database-operations.md#backup-and-restore)
- Run `pnpm audit --prod`. Review advisories against the packaged IAM output
  because the workspace dependency graph includes build and test tools.

## TLS at ingress

Both trusted-proxy settings accept comma-separated peer IPs as seen at the
socket. Have ingress overwrite client-supplied forwarding headers with the
public scheme, public host, and verified client IP. IDP forwards
the resolved client IP when it validates an OIDC page request with the API.
[srvx proxy settings](https://srvx.h3.dev/guide/options#trustproxy)

Set `AUTH_URL` and `AUTH_WEB_ORIGIN` to the exact public HTTPS origin. Check
that `/.well-known/openid-configuration` served through ingress advertises
that origin for the issuer and protocol endpoints. Use that public URL for
`AUTH_OIDC_TEST_URL` when running the hosted integration suite. For a local
fixture with its own CA, set `NODE_EXTRA_CA_CERTS` to the CA certificate so
the SDK can verify TLS.

Include the [HTTPS response headers](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/ops/nginx/iam-https-headers.conf) in the
IAM TLS `server { … }` block. The pilot policy sets HSTS for one day on the
IAM hostname and sends `X-Content-Type-Options: nosniff`. Nginx adds both
headers to redirects and error responses. Keep any plain HTTP listener
limited to redirection to the canonical HTTPS hostname. If a child location
defines its own `add_header` directives, include the HTTPS headers there as
well. Verify both headers through the public ingress on discovery, a hosted
sign-in redirect, and an upstream error.
[HSTS standard](https://www.rfc-editor.org/rfc/rfc6797.html) ·
[Nginx response headers](https://nginx.org/en/docs/http/ngx_http_headers_module.html)

### Ingress logging

Use a dedicated Nginx instance for the IAM ingress. Include the
[IAM logging configuration](https://github.com/xcvzmoon/identity-and-access-management/blob/31d96060a63a7613d10e7634a49c1822687c5381/apps/web/ops/nginx/iam-http-logging.conf) inside
`http { … }`. Enable its access log for the IAM `server { … }` block.

```nginx
access_log /dev/stdout iam_access;
```

The access log records time, a generated ingress request ID, response status,
and duration. It omits URLs, query strings, headers, and bodies. Remove any
other access log destinations from the IAM server and its locations. Apply
the same field policy to logs at any load balancer in front of Nginx.
[Nginx access log configuration](https://nginx.org/en/docs/http/ngx_http_log_module.html)

The included configuration discards HTTP error logs because their request
context can contain the original request line. Keep this setting in effect
for the IAM server and its locations. Use the ingress access status and the
[API audit events](http-api.md#monitor-authentication-outcomes) to track
failures. Keep request tracing and debug logging off for live authentication
traffic. [Nginx error log configuration](https://nginx.org/en/docs/ngx_core_module.html#error_log)

In staging, send synthetic markers in a query string, cookie, authorization
header, and request body. Repeat the check for a request whose upstream fails.
Verify the access records still show the response statuses and that neither
ingress output nor the log collector includes the markers.
