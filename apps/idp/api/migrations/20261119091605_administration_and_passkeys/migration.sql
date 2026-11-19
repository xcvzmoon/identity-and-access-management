CREATE TABLE "iam_idp"."owner_recovery_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"organization_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"case_reference" text NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_recovery_events_organization_id_case_reference_unique" UNIQUE("organization_id","case_reference")
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."passkeys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp(3) with time zone,
	"aaguid" text
);
--> statement-breakpoint
ALTER TABLE "iam_idp"."sessions" ADD COLUMN "passkey_challenge" text;--> statement-breakpoint
ALTER TABLE "iam_idp"."sessions" ADD COLUMN "passkey_verified_at" timestamp(3) with time zone;--> statement-breakpoint
CREATE INDEX "passkeys_userId_idx" ON "iam_idp"."passkeys" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credentialID_idx" ON "iam_idp"."passkeys" ("credential_id");--> statement-breakpoint
ALTER TABLE "iam_idp"."passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam_idp"."users"("id") ON DELETE CASCADE;