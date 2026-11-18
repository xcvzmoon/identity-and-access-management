import { boolean, index, integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateUuid } from '../helpers/index.ts';
import { iamSchema, sessions, users } from './auth.ts';

const initialPolicyVersion = 1;

/** OAuth client registrations, callback settings, and credential verifiers. */
export const oauthClients = iamSchema.table(
  'oauth_clients',
  {
    id: generateUuid(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: boolean('disabled').default(false),
    skipConsent: boolean('skip_consent'),
    enableEndSession: boolean('enable_end_session'),
    subjectType: text('subject_type'),
    scopes: text('scopes').array(),
    clientCredentialsScopes: text('client_credentials_scopes').array().default([]),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts').array(),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').array().notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: boolean('backchannel_logout_session_required'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types').array(),
    responseTypes: text('response_types').array(),
    requirePKCE: boolean('require_pkce'),
    dpopBoundAccessTokens: boolean('dpop_bound_access_tokens').default(false),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata'),
  },
  (table) => [index('oauth_clients_user_id_idx').on(table.userId)],
);

/** Resource identifiers known to the OAuth provider. */
export const oauthResources = iamSchema.table('oauth_resources', {
  id: generateUuid(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes').array(),
  customClaims: jsonb('custom_claims'),
  dpopBoundAccessTokensRequired: boolean('dpop_bound_access_tokens_required').default(false),
  disabled: boolean('disabled').default(false),
  createdAt: timestamp('created_at', TIMESTAMP_CONFIG),
  updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG),
  policyVersion: integer('policy_version').default(initialPolicyVersion),
  metadata: jsonb('metadata'),
});

/** OAuth client-to-resource allowlist entries. */
export const oauthClientResources = iamSchema.table(
  'oauth_client_resources',
  {
    id: generateUuid(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: 'cascade' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG),
  },
  (table) => [
    unique('oauth_client_resources_client_id_resource_id_unique').on(
      table.clientId,
      table.resourceId,
    ),
    index('oauth_client_resources_client_id_idx').on(table.clientId),
    index('oauth_client_resources_resource_id_idx').on(table.resourceId),
  ],
);

/** Provider refresh-token records. */
export const oauthRefreshTokens = iamSchema.table(
  'oauth_refresh_tokens',
  {
    id: generateUuid(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    revoked: timestamp('revoked', TIMESTAMP_CONFIG),
    rotatedAt: timestamp('rotated_at', TIMESTAMP_CONFIG),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: timestamp('rotation_replay_expires_at', TIMESTAMP_CONFIG),
    authTime: timestamp('auth_time', TIMESTAMP_CONFIG),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_refresh_tokens_client_id_idx').on(table.clientId),
    index('oauth_refresh_tokens_session_id_idx').on(table.sessionId),
    index('oauth_refresh_tokens_user_id_idx').on(table.userId),
    index('oauth_refresh_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
  ],
);

/** Access-token records used for live authorization and revocation. */
export const oauthAccessTokens = iamSchema.table(
  'oauth_access_tokens',
  {
    id: generateUuid(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: uuid('refresh_id').references(() => oauthRefreshTokens.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    revoked: timestamp('revoked', TIMESTAMP_CONFIG),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauth_access_tokens_client_id_idx').on(table.clientId),
    index('oauth_access_tokens_session_id_idx').on(table.sessionId),
    index('oauth_access_tokens_user_id_idx').on(table.userId),
    index('oauth_access_tokens_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_tokens_refresh_id_idx').on(table.refreshId),
  ],
);

/** Recorded consent for a user, client, and grant. */
export const oauthConsents = iamSchema.table(
  'oauth_consents',
  {
    id: generateUuid(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    scopes: text('scopes').array().notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG).notNull(),
  },
  (table) => [
    index('oauth_consents_client_id_idx').on(table.clientId),
    index('oauth_consents_user_id_idx').on(table.userId),
  ],
);

/** Client assertion identifiers and their replay-prevention expiry. */
export const oauthClientAssertions = iamSchema.table('oauth_client_assertions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
});

/** Issuer signing keys with public material and encrypted private material. */
export const jwks = iamSchema.table('jwks', {
  id: generateUuid(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
  expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG),
  alg: text('alg'),
  crv: text('crv'),
});
