# IAM rewrite launch scope

## Deployments

The IdP and console each have a Nuxt web workspace and a Nitro API. The IdP
serves hosted sign-in and OIDC endpoints on one issuer origin per deployment.
Its API owns identity and app grants. The console has its own origin, starts
sign-in through OIDC, and keeps its own application session.
[Target monorepo structure](architecture.md#target-monorepo-structure)

## Sign-in

Users sign in with IAM-managed accounts. V1 includes verified email, password
recovery, and passkey step-up for administrators. Customer identity federation
can enter scope when a customer needs to connect its own identity provider.

Account creation starts from an organization invitation. A new invitee creates
and verifies an account for the invited email address. An invitee with a
verified account for that address can accept it with their existing account.

## Application integrations

The console and customer apps with server backends register as confidential
OIDC clients. Each customer app installation has its own registration.
Clients use Authorization Code with S256 PKCE for interactive sign-in.
Machine installation lookup is a separate contract. It enters v1 scope only
if a launch app requires it.

The IdP prompts for consent on first authorization of a customer app and
again when its approved access changes. The consent page identifies the app.
The console is a trusted first-party client and can skip that prompt.

## Console and organization onboarding

Any verified IAM user can open the console to manage their own account.
Organization screens check membership. Administrative actions also check the
user's role and require passkey step-up where applicable.

An IAM operator creates an organization and invites its first owner. An admin
invites each person who joins an existing organization. A verified account
can accept an invitation for its email address. An admin grants app access
separately for each customer app.

Owners enroll a passkey after accepting their verified invitation. If every
owner loses the ability to complete step-up, an IAM operator verifies the
recovery request and records the recovery action in the audit trail.

## Sign-out

App sign-out ends the session in that app. IAM sign-out ends the current SSO
session. The next live access check denies tokens tied to the ended SSO
session. Customer app backends make a live check on every protected request
and deny access when the check is unavailable.

## Rewrite data

Build and validate the rewrite in a separate database with fresh fixtures.
Keep the IdP and console schemas, migrations, and runtime credentials
separate. The rewrite starts with new users, organizations, grants, and
registrations.

## Signing-key operations

Automate routine signing-key rotation before the first external customer goes
live. Publish the replacement before activating it and allow time for client
JWKS caches to refresh. Rehearse rollback and maintain an emergency procedure
for operators.

## App authorization audit

Record app authorization outcomes even when the IdP reuses an SSO session.
Include the app registration, organization, timestamp, outcome, and user ID
when known. Exclude credentials and token values.

## External pilot gate

Before the external pilot, test a deployment with at least two IdP replicas.
Complete sign-in through the console and a reference customer app. Verify
tenant isolation, next-request revocation, audited owner recovery, and
signing-key rollover and rollback.

Better Auth passed the engine evaluation. Set the production issuer hostname
before registering external clients. Define the operator recovery procedure
and audit retention before the pilot.
[Evaluation evidence](plans/iam-v1-rewrite/better-auth-evaluation.md)
