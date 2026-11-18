# Identity and Access Management

IAM signs users in and controls who can use registered applications. A Nitro
server serves the static Nuxt UI, the API, and the OpenID Connect (OIDC) issuer
on one origin. PostgreSQL stores identities, sessions, organization membership,
application grants, and audit events.

Start with the [documentation index](docs/README.md). It links to the
architecture, request flows, references, and operations guides.

| Goal                                         | Where to start                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Run IAM on your machine                      | [Local setup](docs/local.md#local-setup) or [containers](docs/local.md#containers) |
| Review the implementation                    | [Reviewer guide](docs/review.md)                                                   |
| Register an app and assign access            | [Administration guide](docs/administer.md)                                         |
| Try a complete sign-in and permission change | [First app tutorial](docs/first-app.md)                                            |
| Connect an app                               | [OIDC and machine access](docs/integrate-app.md)                                   |
| Deploy or operate IAM                        | [Deployment](docs/deployment.md) and [pilot checks](docs/pilot.md)                 |
| Find a route, setting, table, or function    | [Reference index](docs/README.md#reference)                                        |
