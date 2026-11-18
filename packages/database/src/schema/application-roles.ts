import {
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TIMESTAMP_CONFIG, generateUuid } from '../helpers/index.ts';
import { appAssignments, appInstallations, applications } from './applications.ts';
import { iamSchema } from './auth.ts';

/** Permission keys in an app catalog. */
export const appPermissions = iamSchema.table(
  'app_permissions',
  {
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.key] })],
);

/** Roles defined for an app installation. */
export const appRoles = iamSchema.table(
  'app_roles',
  {
    id: generateUuid(),
    installationId: uuid('installation_id').notNull(),
    applicationId: uuid('application_id').notNull(),
    key: text('key').notNull(),
  },
  (table) => [
    unique('app_roles_installation_key_unique').on(table.installationId, table.key),
    unique('app_roles_installation_id_unique').on(table.installationId, table.id),
    unique('app_roles_application_id_unique').on(table.applicationId, table.id),
    foreignKey({
      name: 'app_roles_installation_fk',
      columns: [table.applicationId, table.installationId],
      foreignColumns: [appInstallations.applicationId, appInstallations.id],
    }).onDelete('restrict'),
  ],
);

/** Permission links scoped to a role and its app catalog. */
export const appRolePermissions = iamSchema.table(
  'app_role_permissions',
  {
    applicationId: uuid('application_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionKey] }),
    index('app_role_permissions_permission_idx').on(table.applicationId, table.permissionKey),
    foreignKey({
      name: 'app_role_permissions_role_fk',
      columns: [table.applicationId, table.roleId],
      foreignColumns: [appRoles.applicationId, appRoles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'app_role_permissions_permission_fk',
      columns: [table.applicationId, table.permissionKey],
      foreignColumns: [appPermissions.applicationId, appPermissions.key],
    }).onDelete('restrict'),
  ],
);

/** Role grants tied to an assignment in the same installation. */
export const appAssignmentRoles = iamSchema.table(
  'app_assignment_roles',
  {
    installationId: uuid('installation_id').notNull(),
    assignmentId: uuid('assignment_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.assignmentId, table.roleId] }),
    index('app_assignment_roles_role_idx').on(table.installationId, table.roleId),
    foreignKey({
      name: 'app_assignment_roles_assignment_fk',
      columns: [table.installationId, table.assignmentId],
      foreignColumns: [appAssignments.installationId, appAssignments.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'app_assignment_roles_role_fk',
      columns: [table.installationId, table.roleId],
      foreignColumns: [appRoles.installationId, appRoles.id],
    }).onDelete('cascade'),
  ],
);

/** Audit records for app registration, credentials, and access changes. */
export const appAccessEvents = iamSchema.table(
  'app_access_events',
  {
    id: generateUuid(),
    actorId: uuid('actor_id').notNull(),
    installationId: uuid('installation_id').notNull(),
    action: text('action').notNull(),
    details: jsonb('details').notNull(),
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
  },
  (table) => [
    index('app_access_events_installation_idx').on(table.installationId, table.createdAt),
  ],
);
