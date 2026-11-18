CREATE TABLE "iam"."app_assignments" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "app_assignments_installation_member_unique" UNIQUE("installation_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "iam"."app_clients" (
	"id" uuid PRIMARY KEY,
	"installation_id" uuid NOT NULL,
	"client_id" text NOT NULL UNIQUE,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "iam"."app_installations" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "app_installations_organization_app_unique" UNIQUE("organization_id","application_id"),
	CONSTRAINT "app_installations_organization_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "iam"."applications" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	CONSTRAINT "applications_organization_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "iam"."invitations" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."members" (
	"id" uuid PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"suspended_at" timestamp(3) with time zone,
	CONSTRAINT "members_organization_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "members_organization_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "iam"."organizations" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"metadata" text,
	"created_at" timestamp(3) with time zone NOT NULL,
	"disabled_at" timestamp(3) with time zone
);
--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD COLUMN "active_organization_id" uuid;--> statement-breakpoint
CREATE INDEX "app_assignments_member_idx" ON "iam"."app_assignments" ("organization_id","member_id");--> statement-breakpoint
CREATE INDEX "app_assignments_installation_idx" ON "iam"."app_assignments" ("organization_id","installation_id");--> statement-breakpoint
CREATE INDEX "app_clients_installation_idx" ON "iam"."app_clients" ("installation_id");--> statement-breakpoint
CREATE INDEX "invitations_organization_idx" ON "iam"."invitations" ("organization_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "iam"."invitations" ("email");--> statement-breakpoint
CREATE INDEX "invitations_inviter_idx" ON "iam"."invitations" ("inviter_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "iam"."members" ("user_id");--> statement-breakpoint
ALTER TABLE "iam"."app_assignments" ADD CONSTRAINT "app_assignments_installation_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "iam"."app_installations"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_assignments" ADD CONSTRAINT "app_assignments_member_fk" FOREIGN KEY ("organization_id","member_id") REFERENCES "iam"."members"("organization_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."app_clients" ADD CONSTRAINT "app_clients_installation_id_app_installations_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "iam"."app_installations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_installations" ADD CONSTRAINT "app_installations_owner_fk" FOREIGN KEY ("organization_id","application_id") REFERENCES "iam"."applications"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam"."organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam"."organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."members" ADD CONSTRAINT "members_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam"."organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."members" ADD CONSTRAINT "members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;