import * as valibot from 'valibot';

const MAX_LABEL_LENGTH = 128;
const MAX_PERMISSIONS = 64;
const MAX_CALLBACK_LENGTH = 2048;

const id = valibot.pipe(valibot.string(), valibot.uuid());
const label = valibot.pipe(
  valibot.string(),
  valibot.trim(),
  valibot.nonEmpty(),
  valibot.maxLength(MAX_LABEL_LENGTH),
);
const role = valibot.pipe(
  label,
  valibot.regex(/^[a-z][a-z0-9_.-]*$/u),
  valibot.check((value) => !Object.hasOwn(Object.prototype, value)),
);
const clientId = id;
const organizationId = id;
const userId = id;
const redirectUri = valibot.pipe(
  valibot.string(),
  valibot.maxLength(MAX_CALLBACK_LENGTH),
  valibot.startsWith('https://'),
  valibot.url(),
  valibot.check((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !value.includes('#') &&
      !value.includes('*')
    );
  }),
);

export const roleCatalogSchema = valibot.object({
  rolePermissions: valibot.record(valibot.string(), valibot.array(valibot.string())),
});

export const managementCommandSchema = valibot.variant('action', [
  valibot.strictObject({ action: valibot.literal('list') }),
  valibot.strictObject({
    action: valibot.literal('details'),
    organizationId,
  }),
  valibot.strictObject({
    action: valibot.literal('rename'),
    organizationId,
    name: label,
  }),
  valibot.strictObject({
    action: valibot.literal('invite'),
    organizationId,
    email: valibot.pipe(valibot.string(), valibot.email()),
    role: valibot.picklist(['admin', 'member']),
  }),
  valibot.strictObject({
    action: valibot.literal('removeMember'),
    organizationId,
    userId,
  }),
  valibot.strictObject({
    action: valibot.literal('register'),
    organizationId,
    name: label,
    redirectUri,
  }),
  valibot.strictObject({
    action: valibot.literal('defineRole'),
    organizationId,
    clientId,
    role,
    permissions: valibot.pipe(valibot.array(label), valibot.maxLength(MAX_PERMISSIONS)),
  }),
  valibot.strictObject({
    action: valibot.literal('assign'),
    organizationId,
    clientId,
    userId,
    role,
  }),
  valibot.strictObject({
    action: valibot.literal('revoke'),
    organizationId,
    clientId,
    userId,
  }),
  valibot.strictObject({
    action: valibot.literal('disableInstallation'),
    organizationId,
    clientId,
  }),
]);
