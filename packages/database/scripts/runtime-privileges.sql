BEGIN;

GRANT CONNECT ON DATABASE :"DBNAME" TO :"runtime_role";
GRANT USAGE ON SCHEMA iam TO :"runtime_role";

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  iam.accounts,
  iam.api_keys,
  iam.invitations,
  iam.members,
  iam.oauth_access_tokens,
  iam.oauth_consents,
  iam.organizations,
  iam.passkeys,
  iam.rate_limits,
  iam.sessions,
  iam.users,
  iam.verifications
TO :"runtime_role";

GRANT SELECT, INSERT, DELETE ON TABLE
  iam.app_assignment_roles,
  iam.app_role_permissions
TO :"runtime_role";

GRANT SELECT, INSERT ON TABLE
  iam.app_assignments,
  iam.app_clients,
  iam.app_installations,
  iam.app_machine_keys,
  iam.app_machine_principals,
  iam.app_permissions,
  iam.app_roles,
  iam.applications,
  iam.jwks
TO :"runtime_role";

GRANT UPDATE (deleted_at, grant_version, updated_at) ON TABLE iam.app_assignments TO :"runtime_role";
GRANT UPDATE (credential_version, updated_at) ON TABLE iam.app_clients TO :"runtime_role";
GRANT UPDATE (id) ON TABLE iam.app_installations, iam.applications TO :"runtime_role";
GRANT UPDATE (installation_id) ON TABLE iam.app_machine_principals TO :"runtime_role";
GRANT UPDATE (key) ON TABLE iam.app_roles TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE iam.oauth_clients TO :"runtime_role";
GRANT SELECT, UPDATE, DELETE ON TABLE iam.oauth_refresh_tokens TO :"runtime_role";
GRANT SELECT ON TABLE iam.oauth_client_resources, iam.oauth_resources TO :"runtime_role";
GRANT INSERT ON TABLE iam.app_access_events TO :"runtime_role";

COMMIT;
