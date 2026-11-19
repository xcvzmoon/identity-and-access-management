CREATE SCHEMA "iam_console";
--> statement-breakpoint
GRANT USAGE ON SCHEMA "iam_console" TO "iam_console_runtime";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "iam_console"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "iam_console_runtime";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "iam_console"
  GRANT USAGE ON SEQUENCES TO "iam_console_runtime";
