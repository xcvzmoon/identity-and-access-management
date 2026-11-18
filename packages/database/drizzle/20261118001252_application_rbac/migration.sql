CREATE TABLE "iam"."app_access_events" (
	"id" uuid PRIMARY KEY,
	"actor_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."app_assignment_roles" (
	"installation_id" uuid NOT NULL,
	"assignment_id" uuid,
	"role_id" uuid,
	CONSTRAINT "app_assignment_roles_pkey" PRIMARY KEY("assignment_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "iam"."app_permissions" (
	"application_id" uuid,
	"key" text,
	CONSTRAINT "app_permissions_pkey" PRIMARY KEY("application_id","key")
);
--> statement-breakpoint
CREATE TABLE "iam"."app_role_permissions" (
	"application_id" uuid NOT NULL,
	"role_id" uuid,
	"permission_key" text,
	CONSTRAINT "app_role_permissions_pkey" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "iam"."app_roles" (
	"id" uuid PRIMARY KEY,
	"installation_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "app_roles_installation_key_unique" UNIQUE("installation_id","key"),
	CONSTRAINT "app_roles_installation_id_unique" UNIQUE("installation_id","id"),
	CONSTRAINT "app_roles_application_id_unique" UNIQUE("application_id","id")
);
--> statement-breakpoint
ALTER TABLE "iam"."app_assignments" ADD CONSTRAINT "app_assignments_installation_id_unique" UNIQUE("installation_id","id");--> statement-breakpoint
ALTER TABLE "iam"."app_installations" ADD CONSTRAINT "app_installations_application_id_unique" UNIQUE("application_id","id");--> statement-breakpoint
CREATE INDEX "app_access_events_installation_idx" ON "iam"."app_access_events" ("installation_id","created_at");--> statement-breakpoint
CREATE INDEX "app_assignment_roles_role_idx" ON "iam"."app_assignment_roles" ("installation_id","role_id");--> statement-breakpoint
CREATE INDEX "app_role_permissions_permission_idx" ON "iam"."app_role_permissions" ("application_id","permission_key");--> statement-breakpoint
ALTER TABLE "iam"."app_assignment_roles" ADD CONSTRAINT "app_assignment_roles_assignment_fk" FOREIGN KEY ("installation_id","assignment_id") REFERENCES "iam"."app_assignments"("installation_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."app_assignment_roles" ADD CONSTRAINT "app_assignment_roles_role_fk" FOREIGN KEY ("installation_id","role_id") REFERENCES "iam"."app_roles"("installation_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."app_permissions" ADD CONSTRAINT "app_permissions_application_id_applications_id_fkey" FOREIGN KEY ("application_id") REFERENCES "iam"."applications"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_role_permissions" ADD CONSTRAINT "app_role_permissions_role_fk" FOREIGN KEY ("application_id","role_id") REFERENCES "iam"."app_roles"("application_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."app_role_permissions" ADD CONSTRAINT "app_role_permissions_permission_fk" FOREIGN KEY ("application_id","permission_key") REFERENCES "iam"."app_permissions"("application_id","key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_roles" ADD CONSTRAINT "app_roles_installation_fk" FOREIGN KEY ("application_id","installation_id") REFERENCES "iam"."app_installations"("application_id","id") ON DELETE RESTRICT;