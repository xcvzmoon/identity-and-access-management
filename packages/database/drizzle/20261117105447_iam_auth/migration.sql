CREATE SCHEMA "iam";
--> statement-breakpoint
CREATE TABLE "iam"."accounts" (
	"id" uuid PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp(3) with time zone,
	"refresh_token_expires_at" timestamp(3) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "iam"."rate_limits" (
	"id" uuid PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."sessions" (
	"id" uuid PRIMARY KEY,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam"."users" (
	"id" uuid PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "iam"."verifications" (
	"id" uuid PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "iam"."accounts" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "iam"."sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "iam"."verifications" ("identifier");--> statement-breakpoint
ALTER TABLE "iam"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam"."users"("id") ON DELETE CASCADE;