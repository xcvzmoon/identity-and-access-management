UPDATE "iam"."jwks"
SET "alg" = 'EdDSA',
    "expires_at" = LEAST("expires_at", CURRENT_TIMESTAMP)
WHERE "alg" IS NULL OR "alg" = 'EdDSA';
