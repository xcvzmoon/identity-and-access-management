import { isNull, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateTimestamps } from './helpers/generate-timestamps.ts';
import { generateUuid } from './helpers/generate-uuid.ts';

const INITIAL_POLICY_VERSION = 1;

export const idpSchema = pgSchema('iam_idp');

export const users = idpSchema.table(
  'users',
  {
    id: generateUuid(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    ...generateTimestamps(),
  },
  (table) => [unique().on(table.email)],
);

export const sessions = idpSchema.table(
  'sessions',
  {
    id: generateUuid(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    token: text('token').notNull(),
    ...generateTimestamps(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    passkeyChallenge: text('passkey_challenge'),
    passkeyVerifiedAt: timestamp('passkey_verified_at', TIMESTAMP_CONFIG),
    activeOrganizationId: uuid('active_organization_id'),
  },
  (table) => [unique().on(table.token), index('sessions_userId_idx').on(table.userId)],
);

export const passkeys = idpSchema.table(
  'passkeys',
  {
    id: generateUuid(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG),
    aaguid: text('aaguid'),
  },
  (table) => [
    index('passkeys_userId_idx').on(table.userId),
    uniqueIndex('passkeys_credentialID_idx').on(table.credentialID),
  ],
);

export const accounts = idpSchema.table(
  'accounts',
  {
    id: generateUuid(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', TIMESTAMP_CONFIG),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', TIMESTAMP_CONFIG),
    scope: text('scope'),
    password: text('password'),
    ...generateTimestamps(),
  },
  (table) => [
    unique().on(table.providerId, table.accountId),
    index('accounts_userId_idx').on(table.userId),
  ],
);

export const verifications = idpSchema.table(
  'verifications',
  {
    id: generateUuid(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    ...generateTimestamps(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

export const organizations = idpSchema.table(
  'organizations',
  {
    id: generateUuid(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    metadata: text('metadata'),
  },
  (table) => [unique().on(table.slug)],
);

export const memberships = idpSchema.table(
  'memberships',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
  },
  (table) => [
    unique().on(table.organizationId, table.userId),
    index('memberships_userId_idx').on(table.userId),
  ],
);

export const invitations = idpSchema.table(
  'invitations',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitations_organizationId_idx').on(table.organizationId),
    index('invitations_inviterId_idx').on(table.inviterId),
    index('invitations_email_idx').on(table.email),
  ],
);

export const rateLimits = idpSchema.table(
  'rate_limits',
  {
    id: generateUuid(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [unique().on(table.key), index('rate_limits_last_request_idx').on(table.lastRequest)],
);

export const signingKeys = idpSchema.table(
  'signing_keys',
  {
    id: generateUuid(),
    publicKey: text('public_key').notNull(),
    privateKey: text('private_key').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG),
    activateAfter: timestamp('activate_after', TIMESTAMP_CONFIG),
    alg: text('alg').notNull(),
    crv: text('crv'),
  },
  (table) => [
    uniqueIndex('signing_keys_pending_alg_idx')
      .on(table.alg)
      .where(sql`${table.activateAfter} is not null`),
    uniqueIndex('signing_keys_active_alg_idx').on(table.alg).where(isNull(table.expiresAt)),
  ],
);

export const oauthClients = idpSchema.table(
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
  (table) => [
    index('oauthClients_userId_idx').on(table.userId),
    check(
      'oauth_clients_console_consent',
      sql`${table.skipConsent} IS NOT TRUE OR ${table.clientId} = 'iam-console'`,
    ),
  ],
);

export const oauthResources = idpSchema.table('oauth_resources', {
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
  policyVersion: integer('policy_version').default(INITIAL_POLICY_VERSION),
  metadata: jsonb('metadata'),
});

export const oauthClientResources = idpSchema.table(
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
    uniqueIndex('oauthClientResources_clientId_resourceId_uidx').on(
      table.clientId,
      table.resourceId,
    ),
    index('oauthClientResources_clientId_idx').on(table.clientId),
    index('oauthClientResources_resourceId_idx').on(table.resourceId),
  ],
);

export const oauthRefreshTokens = idpSchema.table(
  'oauth_refresh_tokens',
  {
    id: generateUuid(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
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
    index('oauthRefreshTokens_clientId_idx').on(table.clientId),
    index('oauthRefreshTokens_sessionId_idx').on(table.sessionId),
    index('oauthRefreshTokens_userId_idx').on(table.userId),
    index('oauthRefreshTokens_authorizationCodeId_idx').on(table.authorizationCodeId),
  ],
);

export const oauthAccessTokens = idpSchema.table(
  'oauth_access_tokens',
  {
    id: generateUuid(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources').array(),
    requestedUserInfoClaims: text('requested_user_info_claims').array(),
    refreshId: uuid('refresh_id').references(() => oauthRefreshTokens.id, {
      onDelete: 'cascade',
    }),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    revoked: timestamp('revoked', TIMESTAMP_CONFIG),
    confirmation: jsonb('confirmation'),
    scopes: text('scopes').array().notNull(),
  },
  (table) => [
    index('oauthAccessTokens_clientId_idx').on(table.clientId),
    index('oauthAccessTokens_sessionId_idx').on(table.sessionId),
    index('oauthAccessTokens_userId_idx').on(table.userId),
    index('oauthAccessTokens_authorizationCodeId_idx').on(table.authorizationCodeId),
    index('oauthAccessTokens_refreshId_idx').on(table.refreshId),
  ],
);

export const oauthConsents = idpSchema.table(
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
    index('oauthConsents_clientId_idx').on(table.clientId),
    index('oauthConsents_userId_idx').on(table.userId),
  ],
);

export const oauthClientAssertions = idpSchema.table('oauth_client_assertions', {
  id: generateUuid(),
  expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
});

export const appInstallations = idpSchema.table(
  'app_installations',
  {
    clientId: text('client_id')
      .primaryKey()
      .references(() => oauthClients.clientId, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
  },
  (table) => [
    unique().on(table.organizationId, table.clientId),
    check('app_installations_customer_client', sql`${table.clientId} <> 'iam-console'`),
  ],
);

export const appGrants = idpSchema.table(
  'app_grants',
  {
    id: generateUuid(),
    clientId: text('client_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    revision: uuid('revision').defaultRandom().notNull(),
  },
  (table) => [
    unique().on(table.clientId, table.userId),
    index('app_grants_membership_idx').on(table.organizationId, table.userId),
    foreignKey({
      columns: [table.organizationId, table.clientId],
      foreignColumns: [appInstallations.organizationId, appInstallations.clientId],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [memberships.organizationId, memberships.userId],
    }).onDelete('cascade'),
    check('app_grants_nonempty_role', sql`length(trim(${table.role})) > 0`),
  ],
);

export const authorizationEvents = idpSchema.table(
  'authorization_events',
  {
    id: generateUuid(),
    clientId: text('client_id').notNull(),
    organizationId: uuid('organization_id'),
    userId: uuid('user_id'),
    outcome: text('outcome', { enum: ['approved', 'denied'] }).notNull(),
    stage: text('stage', { enum: ['authorization', 'consent', 'exchange'] }).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
  },
  (table) => [index('authorization_events_created_at_idx').on(table.createdAt)],
);

export const ownerRecoveryEvents = idpSchema.table(
  'owner_recovery_events',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    operatorId: uuid('operator_id').notNull(),
    caseReference: text('case_reference').notNull(),
    outcome: text('outcome', { enum: ['invited'] }).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
  },
  (table) => [
    unique().on(table.organizationId, table.caseReference),
    index('owner_recovery_events_created_at_idx').on(table.createdAt),
  ],
);

export const processedOwnerRecoveryCases = idpSchema.table('processed_owner_recovery_cases', {
  digest: text('digest').primaryKey(),
});

export const signInEvents = idpSchema.table(
  'sign_in_events',
  {
    id: generateUuid(),
    userId: uuid('user_id').notNull(),
    entry: text('entry', { enum: ['web_form', 'api'] }).notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
  },
  (table) => [
    index('sign_in_events_account_idx').on(table.userId, table.createdAt),
    index('sign_in_events_expiry_idx').on(table.createdAt),
    check('sign_in_events_entry', sql`${table.entry} in ('web_form', 'api')`),
  ],
);

export const signInCounts = idpSchema.table(
  'sign_in_counts',
  {
    day: date('day').notNull(),
    entry: text('entry', { enum: ['web_form', 'api'] }).notNull(),
    outcome: text('outcome', { enum: ['issued', 'rejected'] }).notNull(),
    total: bigint('total', { mode: 'bigint' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.entry, table.outcome] }),
    check('sign_in_counts_entry', sql`${table.entry} in ('web_form', 'api')`),
    check('sign_in_counts_outcome', sql`${table.outcome} in ('issued', 'rejected')`),
  ],
);
