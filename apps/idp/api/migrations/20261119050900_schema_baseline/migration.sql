CREATE SCHEMA "iam_idp";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "iam_idp" TO "iam_idp_runtime";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "iam_idp"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "iam_idp_runtime";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "iam_idp"
  GRANT USAGE ON SEQUENCES TO "iam_idp_runtime";
