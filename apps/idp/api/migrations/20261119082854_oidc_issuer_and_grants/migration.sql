CREATE TABLE "iam_idp"."app_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "app_grants_client_id_user_id_unique" UNIQUE("client_id","user_id"),
	CONSTRAINT "app_grants_nonempty_role" CHECK (length(trim("role")) > 0)
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."app_installations" (
	"client_id" text PRIMARY KEY,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "app_installations_organization_id_client_id_unique" UNIQUE("organization_id","client_id"),
	CONSTRAINT "app_installations_customer_client" CHECK ("client_id" <> 'iam-console')
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."authorization_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"outcome" text NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" uuid,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"revoked" timestamp(3) with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_client_assertions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"expires_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_client_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL UNIQUE,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}'::text[],
	"user_id" uuid,
	"created_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_clients_console_consent" CHECK ("skip_consent" IS NOT TRUE OR "client_id" = 'iam-console')
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" text NOT NULL,
	"user_id" uuid,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"updated_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" uuid,
	"user_id" uuid NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"revoked" timestamp(3) with time zone,
	"rotated_at" timestamp(3) with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp(3) with time zone,
	"auth_time" timestamp(3) with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."oauth_resources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identifier" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "iam_idp"."signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp(3) with time zone NOT NULL,
	"expires_at" timestamp(3) with time zone,
	"alg" text NOT NULL,
	"crv" text
);
--> statement-breakpoint
CREATE INDEX "app_grants_membership_idx" ON "iam_idp"."app_grants" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessTokens_clientId_idx" ON "iam_idp"."oauth_access_tokens" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthAccessTokens_sessionId_idx" ON "iam_idp"."oauth_access_tokens" ("session_id");--> statement-breakpoint
CREATE INDEX "oauthAccessTokens_userId_idx" ON "iam_idp"."oauth_access_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthAccessTokens_authorizationCodeId_idx" ON "iam_idp"."oauth_access_tokens" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "oauthAccessTokens_refreshId_idx" ON "iam_idp"."oauth_access_tokens" ("refresh_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauthClientResources_clientId_resourceId_uidx" ON "iam_idp"."oauth_client_resources" ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "oauthClientResources_clientId_idx" ON "iam_idp"."oauth_client_resources" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthClientResources_resourceId_idx" ON "iam_idp"."oauth_client_resources" ("resource_id");--> statement-breakpoint
CREATE INDEX "oauthClients_userId_idx" ON "iam_idp"."oauth_clients" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthConsents_clientId_idx" ON "iam_idp"."oauth_consents" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthConsents_userId_idx" ON "iam_idp"."oauth_consents" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshTokens_clientId_idx" ON "iam_idp"."oauth_refresh_tokens" ("client_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshTokens_sessionId_idx" ON "iam_idp"."oauth_refresh_tokens" ("session_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshTokens_userId_idx" ON "iam_idp"."oauth_refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "oauthRefreshTokens_authorizationCodeId_idx" ON "iam_idp"."oauth_refresh_tokens" ("authorization_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_keys_active_alg_idx" ON "iam_idp"."signing_keys" ("alg") WHERE ("expires_at" is null);--> statement-breakpoint
ALTER TABLE "iam_idp"."app_grants" ADD CONSTRAINT "app_grants_p25qdkb79CaZ_fkey" FOREIGN KEY ("organization_id","client_id") REFERENCES "iam_idp"."app_installations"("organization_id","client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."app_grants" ADD CONSTRAINT "app_grants_VntYJ9UunkyL_fkey" FOREIGN KEY ("organization_id","user_id") REFERENCES "iam_idp"."memberships"("organization_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."app_installations" ADD CONSTRAINT "app_installations_client_id_oauth_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "iam_idp"."oauth_clients"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."app_installations" ADD CONSTRAINT "app_installations_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "iam_idp"."organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "iam_idp"."oauth_clients"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "iam_idp"."sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam_idp"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_refresh_id_oauth_refresh_tokens_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "iam_idp"."oauth_refresh_tokens"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_client_id_oauth_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "iam_idp"."oauth_clients"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_CxFm94nYigrM_fkey" FOREIGN KEY ("resource_id") REFERENCES "iam_idp"."oauth_resources"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_clients" ADD CONSTRAINT "oauth_clients_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam_idp"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_oauth_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "iam_idp"."oauth_clients"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam_idp"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "iam_idp"."oauth_clients"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_session_id_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "iam_idp"."sessions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "iam_idp"."oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "iam_idp"."users"("id") ON DELETE CASCADE;