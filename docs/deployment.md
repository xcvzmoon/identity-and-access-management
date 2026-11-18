# Deploy IAM

[Documentation index](README.md)

## Deployment

Build with `vp run build` and ship the full `apps/api/.output` directory.
Start `apps/api/.output/server/index.mjs`, or use the image from the
[Dockerfile](../Dockerfile). Set `APP_ENV="production"`.

1. Configure the migration role and a separate runtime login. Require TLS for
   both database connections. [Deployment roles](database-operations.md#deployment-roles) ·
   [PostgreSQL TLS](database.md#postgresql-tls-in-deployment)
2. Drain older replicas before running the migration that revokes unverified
   sessions. Apply pending migrations as the migration owner.
   [Session migration](http-api.md#authentication-routes)
3. Set `AUTH_URL` and `AUTH_WEB_ORIGIN` to the same public HTTPS origin.
   Share `AUTH_SECRET` across replicas. Configure the SMTP relay.
   [API configuration](http-api.md#configuration)
4. Route HTTPS traffic to Nitro. Keep the service port private. Set
   `IAM_API_TRUSTED_PROXIES` to the ingress peer IPs and configure ingress to
   replace incoming forwarding headers. [Ingress and TLS](#tls-at-ingress)
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

Set `IAM_API_TRUSTED_PROXIES` to the proxy IP addresses that the Nitro
process sees at the socket. Keep the HTTP upstream private and have ingress
overwrite client-supplied forwarding headers with the public scheme, public
host, and verified client IP.
[srvx proxy settings](https://srvx.h3.dev/guide/options#trustproxy)

Set `AUTH_URL` and `AUTH_WEB_ORIGIN` to the exact public HTTPS origin. Check
that `/.well-known/openid-configuration` served through ingress advertises
that origin for the issuer and protocol endpoints. Use that public URL for
`AUTH_OIDC_TEST_URL` when running the hosted integration suite. For a local
fixture with its own CA, set `NODE_EXTRA_CA_CERTS` to the CA certificate so
the SDK can verify TLS.

Include the [HTTPS response headers](../apps/web/ops/nginx/iam-https-headers.conf) in the
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
[IAM logging configuration](../apps/web/ops/nginx/iam-http-logging.conf) inside
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
