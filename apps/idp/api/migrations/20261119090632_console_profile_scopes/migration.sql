UPDATE "iam_idp"."oauth_clients"
SET "scopes" = ARRAY['openid', 'email', 'profile']
WHERE "client_id" = 'iam-console' AND "scopes" = ARRAY['openid'];
