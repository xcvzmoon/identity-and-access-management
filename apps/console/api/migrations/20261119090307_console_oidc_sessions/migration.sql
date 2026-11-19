CREATE TABLE "iam_console"."authorization_transactions" (
	"cookie_hash" text PRIMARY KEY,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"verifier" text NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_console"."sessions" (
	"cookie_hash" text PRIMARY KEY,
	"sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "authorization_transactions_expires_at_index" ON "iam_console"."authorization_transactions" ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_index" ON "iam_console"."sessions" ("expires_at");