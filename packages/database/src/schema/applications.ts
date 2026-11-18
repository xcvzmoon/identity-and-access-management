import { foreignKey, index, text, unique, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { iamSchema } from './auth.ts';
import { oauthClients } from './oauth.ts';
import { members, organizations } from './organizations.ts';

/** App registrations owned by one organization. */
export const applications = iamSchema.table(
  'applications',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...generateTimestamps(),
  },
  (table) => [unique('applications_organization_id_unique').on(table.organizationId, table.id)],
);

/** Organization installations bound to an app owned by that organization. */
export const appInstallations = iamSchema.table(
  'app_installations',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    ...generateTimestamps(),
  },
  (table) => [
    unique('app_installations_organization_app_unique').on(
      table.organizationId,
      table.applicationId,
    ),
    unique('app_installations_application_id_unique').on(table.applicationId, table.id),
    unique('app_installations_organization_id_unique').on(table.organizationId, table.id),
    foreignKey({
      name: 'app_installations_owner_fk',
      columns: [table.organizationId, table.applicationId],
      foreignColumns: [applications.organizationId, applications.id],
    }).onDelete('restrict'),
  ],
);

/** OIDC client bindings and credential versions for app installations. */
export const appClients = iamSchema.table(
  'app_clients',
  {
    id: generateUuid(),
    installationId: uuid('installation_id')
      .notNull()
      .references(() => appInstallations.id, { onDelete: 'restrict' }),
    clientId: text('client_id')
      .notNull()
      .unique()
      .references(() => oauthClients.clientId, { onDelete: 'restrict' }),
    credentialVersion: uuid('credential_version').notNull().defaultRandom(),
    ...generateTimestamps(),
  },
  (table) => [index('app_clients_installation_idx').on(table.installationId)],
);

/** App access grants tied to memberships in the owning organization. */
export const appAssignments = iamSchema.table(
  'app_assignments',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id').notNull(),
    installationId: uuid('installation_id').notNull(),
    memberId: uuid('member_id').notNull(),
    grantVersion: uuid('grant_version').notNull().defaultRandom(),
    ...generateTimestamps(),
  },
  (table) => [
    unique('app_assignments_installation_id_unique').on(table.installationId, table.id),
    unique('app_assignments_installation_member_unique').on(table.installationId, table.memberId),
    index('app_assignments_member_idx').on(table.organizationId, table.memberId),
    index('app_assignments_installation_idx').on(table.organizationId, table.installationId),
    foreignKey({
      name: 'app_assignments_installation_fk',
      columns: [table.organizationId, table.installationId],
      foreignColumns: [appInstallations.organizationId, appInstallations.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'app_assignments_member_fk',
      columns: [table.organizationId, table.memberId],
      foreignColumns: [members.organizationId, members.id],
    }).onDelete('cascade'),
  ],
);
