# Operate audit and deletion workflows

[Documentation index](README.md)

## Monitor pilot activity

Provision a dedicated login for the alert collector. Give it no database
ownership or role memberships. Apply the column grants as the migration
owner. The collector can read installation IDs, event actions, and event
times. Actor IDs, event details, and other IAM tables require separate access.
[PostgreSQL column grants](https://www.postgresql.org/docs/current/sql-grant.html)

```sh
psql -X --set=ON_ERROR_STOP=1 --set=monitor_role=iam_audit_monitor \
  --file=packages/database/scripts/audit-monitor-privileges.sql
```

Connect as the collector and run the query for each pilot installation. Set
`IAM_PILOT_INSTALLATION_ID` to the registered installation's UUID.

```sh
psql -X --csv --set=ON_ERROR_STOP=1 \
  --set=installation_id="$IAM_PILOT_INSTALLATION_ID" \
  --file=packages/database/scripts/pilot-audit-counts.sql
```

Poll once per minute. Each row counts activity over the preceding five
minutes, including repeated grant operations. A quiet installation returns
zero for both counts. Treat a failed or missing poll as an alerting failure.
Group repeated notifications by installation and signal while the window
remains above the alert threshold.

| Signal             | When to alert                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callback_changes` | Alert when the count is above zero. Verify the change with the installation owner and use the pilot containment procedure if the change was unauthorized. |
| `grant_operations` | Alert when the count exceeds the pilot's expected five-minute grant volume. Review the actor and target in the restricted audit store.                    |

In staging, replace a test app callback and grant a test assignment. Verify
both counts increase for that installation and stay at zero for an idle
control installation. Confirm the alerts reach the on-call collector
destination. [Pilot containment procedure](pilot.md#stop-a-pilot-app)

## Retain and expire app audit events

Set an audit retention period before the pilot. Apply it to app audit
records and set the API and ingress log retention in the log collector.
Check for incident holds before expiring records. Use the retention policy
for the environment when setting `IAM_AUDIT_CUTOFF` to an absolute UTC
timestamp in `YYYY-MM-DDTHH:MM:SSZ` format. Events strictly older than that
timestamp are eligible.

Set the PostgreSQL connection variables for the intended database. Run the
preview as an audit reader. The output contains only the count of eligible
app audit events.

```sh
psql -X --set=cutoff="$IAM_AUDIT_CUTOFF" \
  --file=packages/database/scripts/audit-retention.sql
```

After reviewing the count, connect as the migration owner and use the same
cutoff with `--set=apply=on`. Each invocation deletes up to 1,000 events in
a single transaction, starting with the oldest. Repeat until the preview
returns zero. Record the cutoff and deletion counts in the maintenance log.
Keep retention execution outside the API and alert collector.
[PostgreSQL batch deletion](https://www.postgresql.org/docs/current/sql-delete.html)

Reapply the approved cutoff after restoring a database. Apply backup
retention through the database provider so older archives expire on schedule.

## Prepare an account deletion

Verify the request and resolve the account to its IAM user UUID. Run the
preflight as a restricted database operator with read access to IAM
records. Use PostgreSQL 16 or later for this query.

```sh
psql -X --csv --set=user_id="$IAM_DELETION_USER_ID" \
  --file=packages/database/scripts/account-deletion-preflight.sql
```

The report contains counts for the account and its current memberships.
A missing account produces no result row. Use the report to plan the
approved deletion and verify its scope.

- Transfer organization ownership where the report lists owner memberships.
  Review user-owned OAuth clients before proceeding. Managed app clients
  registered with an organization reference belong to the organization.
- Account deletion cascades to credential accounts, sessions, passkeys,
  memberships, assignments, sent invitations, and user-bound OAuth tokens
  and consents. Review current and former email addresses for invitations
  and email codes. Authorization codes and account email rate limits live
  outside those foreign-key relationships.
- Review audit events and API logs under the retention policy. The report
  counts database audit events for the actor and assignment events for
  memberships still present. Review data held by registered apps, email
  delivery systems, and backup storage with their respective operators.

Record the approved deletion so operators can reapply it after a restore.
Prioritize reconciling restored access before bringing the database online.

## Delete an approved account

Complete the [account deletion preflight](#prepare-an-account-deletion) and
resolve any organization ownership or user-owned OAuth clients it identifies.
Pause IAM API traffic and drain background email jobs during the operation.
This prevents concurrent requests from writing new verification or invitation
records for the account email.

Connect as the migration owner and pass the same approved user UUID.

```sh
psql -X --set=user_id="$IAM_DELETION_USER_ID" --set=apply=on \
  --file=packages/database/scripts/delete-account.sql
```

The script deletes the account and its dependent records in one transaction.
It also clears received invitations, email codes for the current address,
authorization codes, and account email rate limits. Database audit events
remain subject to the [audit retention policy](#retain-and-expire-app-audit-events).
Handle records for former addresses and systems outside IAM through the
approved deletion request.

Confirm the preflight returns no account row. In a rehearsal, also verify
that a prior session and app access token fail and that a control account
can still sign in. Record the completed deletion in the restricted
maintenance log before reopening traffic.

## Audit record reference

Database events retain the actor ID, installation ID, action, details, and
creation time. The API runtime inserts events with the corresponding
management write. The monitor can read installation ID, action, and time.

| Management operation                                                | Database action                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Register an application                                             | `application.registered`                                               |
| Register permissions or save a role                                 | `permissions.registered`, `role.saved`                                 |
| Grant or revoke an assignment                                       | `assignment.granted`, `assignment.revoked`                             |
| Suspend an assigned member                                          | `membership.suspended`                                                 |
| Disable an OAuth client, rotate its secret, or replace its callback | `client.disabled`, `client.secret_rotated`, `client.callback_replaced` |
| Issue, rotate, or revoke a machine key                              | `machine_key.issued`, `machine_key.rotated`, `machine_key.revoked`     |

Service logs also record invitation creation, acceptance, and cancellation,
organization member role changes and ownership transfers, and delivery
failures. Credential material and email codes belong outside audit stores.
Restrict event identifiers and metadata using the environment's access and
retention policy.

[HTTP authentication audit](http-api.md#authentication-audit-events) ·
[Ingress logging](deployment.md#ingress-logging)
