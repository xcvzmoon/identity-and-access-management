# IAM integration MCP server

Run `vp install` in the IAM checkout. Configure your MCP client to launch Node 26 with the absolute path to `tools/iam-mcp/server.ts`. The server communicates over stdio and reads documents relative to its own file, so the client can launch it from any directory.

For Codex, add the following entry to your MCP configuration. Replace the example checkout path and issuer origin with your own.

```toml
[mcp_servers.iam]
command = "node"
args = ["/absolute/path/to/identity-and-access-management/tools/iam-mcp/server.ts"]

[mcp_servers.iam.env]
OIDC_ISSUER_URL = "https://idp.localhost"
```

Ask “How should my app validate the callback and authorize a protected request?” to use `read_integration_guide`. Clients that support MCP resources can also read the local setup guide, architecture, signing-key guide, and reference app source under `iam://project/`.

Ask “Which authorization, token, and introspection endpoints does my issuer advertise?” to use `get_issuer_metadata`. Set `OIDC_ISSUER_URL` to the canonical HTTPS origin without a trailing slash. For a private certificate authority, set `NODE_EXTRA_CA_CERTS` to its PEM file in the server environment. Documentation works offline with the issuer setting omitted. Both tools work without IAM credentials.
