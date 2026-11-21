import * as valibot from 'valibot';

export type ManagementActionName = keyof typeof operations;
export type OrganizationDetails = valibot.InferOutput<typeof detailsSchema>;

export const organizationsSchema = valibot.object({
  organizations: valibot.array(
    valibot.object({
      id: valibot.string(),
      name: valibot.string(),
      role: valibot.string(),
    }),
  ),
});

const memberName = valibot.nullish(valibot.string());
const rolePermissions = valibot.record(valibot.string(), valibot.array(valibot.string()));

export const detailsSchema = valibot.object({
  members: valibot.array(
    valibot.object({
      userId: valibot.string(),
      name: memberName,
      email: valibot.string(),
      role: valibot.string(),
    }),
  ),
  invitations: valibot.array(
    valibot.object({
      email: valibot.string(),
      status: valibot.string(),
      role: valibot.string(),
    }),
  ),
  installations: valibot.array(
    valibot.object({
      clientId: valibot.string(),
      name: valibot.string(),
      rolePermissions,
    }),
  ),
  assignments: valibot.array(
    valibot.object({
      clientId: valibot.string(),
      userId: valibot.string(),
      role: valibot.string(),
    }),
  ),
});

export const operations = {
  invite: 'Invite a member',
  register: 'Register an app',
  defineRole: 'Define an installation role',
  assign: 'Assign an installation role',
  revoke: 'Revoke an assignment',
  removeMember: 'Remove a member',
  disableInstallation: 'Disable an installation',
  rename: 'Rename organization',
};

export const managementSections = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'i-lucide-layout-grid',
    actions: [],
  },
  {
    label: 'Organizations',
    to: '/management',
    icon: 'i-lucide-building-2',
    actions: ['rename'],
  },
  {
    label: 'Members',
    to: '/members',
    icon: 'i-lucide-users',
    actions: ['invite', 'removeMember'],
  },
  {
    label: 'Invitations',
    to: '/invitations',
    icon: 'i-lucide-mail-plus',
    actions: ['invite'],
  },
  {
    label: 'Applications',
    to: '/applications',
    icon: 'i-lucide-blocks',
    actions: ['register', 'disableInstallation'],
  },
  {
    label: 'Roles & access',
    to: '/access',
    icon: 'i-lucide-key-round',
    actions: ['assign', 'defineRole', 'revoke'],
  },
] as const;
