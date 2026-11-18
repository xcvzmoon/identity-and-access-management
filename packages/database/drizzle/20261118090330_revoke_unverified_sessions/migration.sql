DELETE FROM "iam"."sessions" AS session
USING "iam"."users" AS account
WHERE session."user_id" = account."id"
  AND account."email_verified" IS FALSE;
