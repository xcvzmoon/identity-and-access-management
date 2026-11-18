CREATE TABLE "iam"."passkeys" (
	"id" uuid PRIMARY KEY,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL UNIQUE,
	"counter" bigint NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp(3) with time zone,
	"aaguid" text
);
--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD COLUMN "admin_passkey_id" uuid;--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD COLUMN "admin_verified_at" timestamp(3) with time zone;--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "iam"."passkeys" ("user_id");--> statement-breakpoint
ALTER TABLE "iam"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;