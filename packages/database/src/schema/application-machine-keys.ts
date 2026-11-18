import {
  boolean,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateUuid } from '../helpers/index.ts';
import { appInstallations } from './applications.ts';
import { iamSchema } from './auth.ts';
import { organizations } from './organizations.ts';

/** Better Auth API key records, including verifiers and usage limits. */
export const apiKeys = iamSchema.table(
  'api_keys',
  {
    id: generateUuid(),
    configId: text('config_id').notNull(),
    name: text('name'),
    start: text('start'),
    referenceId: uuid('reference_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    prefix: text('prefix'),
    key: text('key').notNull().unique(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', TIMESTAMP_CONFIG),
    enabled: boolean('enabled').default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count'),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', TIMESTAMP_CONFIG),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG).notNull(),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => [
    unique('api_keys_owner_id_unique').on(table.referenceId, table.id),
    index('api_keys_config_idx').on(table.configId),
  ],
);

/** Machine identities bound to app installations. */
export const appMachinePrincipals = iamSchema.table(
  'app_machine_principals',
  {
    id: generateUuid(),
    installationId: uuid('installation_id').notNull().unique(),
    organizationId: uuid('organization_id').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
  },
  (table) => [
    unique('app_machine_principals_owner_id_unique').on(table.organizationId, table.id),
    foreignKey({
      name: 'app_machine_principals_installation_fk',
      columns: [table.organizationId, table.installationId],
      foreignColumns: [appInstallations.organizationId, appInstallations.id],
    }).onDelete('restrict'),
  ],
);

/** Bindings between API keys and installation machine identities. */
export const appMachineKeys = iamSchema.table(
  'app_machine_keys',
  {
    keyId: uuid('key_id').primaryKey(),
    principalId: uuid('principal_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
  },
  (table) => [
    index('app_machine_keys_principal_idx').on(table.organizationId, table.principalId),
    foreignKey({
      name: 'app_machine_keys_owner_key_fk',
      columns: [table.organizationId, table.keyId],
      foreignColumns: [apiKeys.referenceId, apiKeys.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'app_machine_keys_owner_principal_fk',
      columns: [table.organizationId, table.principalId],
      foreignColumns: [appMachinePrincipals.organizationId, appMachinePrincipals.id],
    }).onDelete('restrict'),
  ],
);
