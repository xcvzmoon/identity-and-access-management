CREATE TABLE "iam"."api_keys" (
	"id" uuid PRIMARY KEY,
	"config_id" text NOT NULL,
	"name" text,
	"start" text,
	"reference_id" uuid NOT NULL,
	"prefix" text,
	"key" text NOT NULL UNIQUE,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp(3) with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer,
	"remaining" integer,
	"last_request" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL,
	"permissions" text,
	"metadata" text,
	CONSTRAINT "api_keys_owner_id_unique" UNIQUE("reference_id","id")
);
--> statement-breakpoint
CREATE TABLE "iam"."app_machine_keys" (
	"key_id" uuid PRIMARY KEY,
	"principal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."app_machine_principals" (
	"id" uuid PRIMARY KEY,
	"installation_id" uuid NOT NULL UNIQUE,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_machine_principals_owner_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE INDEX "api_keys_config_idx" ON "iam"."api_keys" ("config_id");--> statement-breakpoint
CREATE INDEX "app_machine_keys_principal_idx" ON "iam"."app_machine_keys" ("organization_id","principal_id");--> statement-breakpoint
ALTER TABLE "iam"."api_keys" ADD CONSTRAINT "api_keys_reference_id_organizations_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "iam"."organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_machine_keys" ADD CONSTRAINT "app_machine_keys_owner_key_fk" FOREIGN KEY ("organization_id","key_id") REFERENCES "iam"."api_keys"("reference_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."app_machine_keys" ADD CONSTRAINT "app_machine_keys_owner_principal_fk" FOREIGN KEY ("organization_id","principal_id") REFERENCES "iam"."app_machine_principals"("organization_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "iam"."app_machine_principals" ADD CONSTRAINT "app_machine_principals_installation_fk" FOREIGN KEY ("organization_id","installation_id") REFERENCES "iam"."app_installations"("organization_id","id") ON DELETE RESTRICT;