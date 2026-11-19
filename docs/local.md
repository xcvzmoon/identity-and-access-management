# Run the IAM workspaces locally

[Documentation index](README.md) · [Workspace reference](development.md)

## Local setup

Install Vite+ and run `vp install` from the repository root. Start each
workspace you need in its own terminal.

| Workspace   | Command                          | Local address                      |
| ----------- | -------------------------------- | ---------------------------------- |
| IdP web     | `vp -C apps/idp/web run dev`     | `http://localhost:3000` by default |
| IdP API     | `vp -C apps/idp/api run dev`     | `http://localhost:65430/api/hello` |
| Console web | `vp -C apps/console/web run dev` | `http://localhost:3001`            |
| Console API | `vp -C apps/console/api run dev` | `http://localhost:65431/api/hello` |

Use the port printed by the dev server if the default is busy. The web
workspaces serve their scaffold pages. Both API examples return
`{"message":"Hello from Nitro!"}`. These entry points are for checking the
workspaces. The public issuer and sign-in flows are part of the rewrite.

## Database settings

When working on database code, copy each API's `.env.example` to `.env` in
that API directory if the file is missing. Fill in your local PostgreSQL
credentials and keep dotenv values double-quoted. The scaffold pages and
the `/api/hello` routes can run without a database. Phase 2 defines the
fresh database, schema ownership, roles, and first migrations.
[IdP example](../apps/idp/api/.env.example) · [Console example](../apps/console/api/.env.example) · [Phase 2](plans/iam-v1-rewrite/phase-02-establish-apps-and-storage.md)

## Containers

The checked-in Dockerfile and Compose configuration target the retired POC.
Run the four workspaces directly during scaffold development. V1 images and
ingress are tracked in the pilot plan.
[Pilot phase](plans/iam-v1-rewrite/phase-10-external-pilot.md)
