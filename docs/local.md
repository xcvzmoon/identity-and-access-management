# Run IAM locally

[Documentation index](README.md)

## Local setup

Install Vite+ and OpenSSL. Make a PostgreSQL server reachable from your machine.
Run the following steps from the repository root.

1. Install the pinned dependencies and build the workspace.

   ```sh
   vp install
   vp run build
   ```

2. Create the local environment files.

   ```sh
   vp run create-env
   ```

   Fill in the database settings when prompted. Review the generated settings
   before running migrations. The command writes a Better Auth secret and
   preserves configured files by default. Keep secrets local and use double
   quotes for dotenv values. [Auth example](../packages/auth/.env.example) ·
   [Database example](../packages/database/.env.example)

3. Apply the pending migrations and start IAM.

   ```sh
   vp run packages:database migrate
   vp run apps:api preview
   ```

   The migration command can create a missing database when the role has
   `CREATEDB` and access to the `postgres` maintenance database.
   [Migration requirements](database-operations.md#schema-and-migrations)

4. Set `AUTH_SMTP_URL` and `AUTH_SMTP_FROM` before testing email codes.
   Restart IAM if you change its settings after startup. Open
   `http://localhost:5173/signup`. Use the emailed code to verify ownership
   and set a password before signing in. [SMTP settings](http-api.md#configuration)

After editing the UI, run `vp run apps:web build` and
`vp run apps:api build` to refresh the served assets. Run `vp run build` when
you change a shared package. If you run `vp run create-env --force`, the command
replaces the local settings and rotates the auth secret. A new secret
invalidates existing sessions. Retain the corresponding secret version
for any local database backup that contains encrypted issuer keys.

## Containers

Configure the local environment files and run database migrations first.
Then start the single IAM service.

```sh
vp run docker up
vp run docker ps
vp run docker logs --follow
```

Compose publishes IAM at `http://localhost:5173` on loopback. The container uses
`host.docker.internal` to connect to PostgreSQL on the host. Set
`DOCKER_DB_HOST` if your database uses a different reachable host.

Use `--container docker` or `--container kiri` to select an engine. Run
`vp run docker --help` for the available commands.
