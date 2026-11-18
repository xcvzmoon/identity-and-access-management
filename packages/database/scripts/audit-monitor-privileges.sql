BEGIN;

GRANT CONNECT ON DATABASE :"DBNAME" TO :"monitor_role";
GRANT USAGE ON SCHEMA iam TO :"monitor_role";
GRANT SELECT (installation_id, action, created_at)
  ON TABLE iam.app_access_events TO :"monitor_role";

COMMIT;
