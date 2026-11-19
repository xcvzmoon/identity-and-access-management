SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "iam_idp"."owner_invitation_deliveries" (
	"invitation_id" uuid PRIMARY KEY,
	"next_attempt_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"attempt_id" uuid
);
--> statement-breakpoint
CREATE INDEX "owner_invitation_deliveries_next_attempt_at_index" ON "iam_idp"."owner_invitation_deliveries" ("next_attempt_at");--> statement-breakpoint
ALTER TABLE "iam_idp"."owner_invitation_deliveries" ADD CONSTRAINT "owner_invitation_deliveries_invitation_id_invitations_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "iam_idp"."invitations"("id") ON DELETE CASCADE;
