import type { useDatabase } from '@iam/database';
import type { AuthOptions } from './auth.ts';
import { schema } from '@iam/database';
import { APIError } from 'better-auth/api';
import * as valibot from 'valibot';
import { applicationCallbackSchema } from './application-callback.ts';
import { withAuthAdapter } from './auth-adapter-scope.ts';
import { createAuth } from './auth.ts';
import { lockOrganizationAdmin } from './organization-admin.ts';

type Database = Pick<ReturnType<typeof useDatabase>, 'transaction'>;
type RegistrationOptions = Pick<AuthOptions, 'secret' | 'url' | 'webOrigin'>;
type RegistrationResult = {
  applicationId: string;
  installationId: string;
  clientId: string;
  clientSecret: string;
  tokenEndpointAuthMethod: valibot.InferOutput<typeof applicationClientAuthMethodSchema>;
};

const maximumNameLength = 120;
export const applicationClientAuthMethodSchema = valibot.picklist([
  'client_secret_basic',
  'client_secret_post',
]);
const registrationSchema = valibot.object({
  organizationId: valibot.pipe(valibot.string(), valibot.uuid()),
  name: valibot.pipe(
    valibot.string(),
    valibot.trim(),
    valibot.nonEmpty(),
    valibot.maxLength(maximumNameLength),
  ),
  redirectUri: applicationCallbackSchema,
  tokenEndpointAuthMethod: valibot.optional(
    applicationClientAuthMethodSchema,
    'client_secret_basic',
  ),
});
type RegistrationInput = valibot.InferInput<typeof registrationSchema>;

/**
 * Provisions a private application and confidential OIDC client in one transaction.
 * Call from a trusted server after enforcing recent MFA. The session must belong to an
 * active, verified owner or admin of the organization.
 * @param {Database} database - Shared IAM database.
 * @param {RegistrationOptions} options - Issuer and auth configuration.
 * @param {Headers} headers - Request headers containing the administrator's IAM session.
 * @param {RegistrationInput} input - Owner organization, display name, callback, and optional client authentication method.
 * @returns {Promise<RegistrationResult>} New registration and one-time client secret.
 * @throws {APIError} Invalid metadata, an unauthorized actor, or provisioning failure.
 */
export async function registerApplication(
  database: Database,
  options: RegistrationOptions,
  headers: Headers,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  const parsed = valibot.safeParse(registrationSchema, input);
  if (!parsed.success) {
    throw new APIError('BAD_REQUEST', { message: 'Invalid application registration' });
  }

  const { organizationId, name, redirectUri, tokenEndpointAuthMethod } = parsed.output;
  return database.transaction(async (transaction) => {
    const auth = createAuth(transaction, {
      ...options,
      registration: {
        clientReference: () => organizationId,
        clientPrivileges: async ({ action, user }) => {
          if (action !== 'create' || !user) {
            return false;
          }

          return lockOrganizationAdmin(transaction, organizationId, user.id);
        },
      },
    });

    return withAuthAdapter(auth, async () => {
      const client = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: name,
          redirect_uris: [redirectUri],
          application_type: 'web',
          token_endpoint_auth_method: tokenEndpointAuthMethod,
          scope: 'openid',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          require_pkce: true,
        },
      });

      if (!client.client_secret) {
        throw new Error('Confidential OAuth client credential was not issued');
      }

      const [{ id: applicationId }] = await transaction
        .insert(schema.applications)
        .values({ organizationId, name })
        .returning({ id: schema.applications.id });
      const [{ id: installationId }] = await transaction
        .insert(schema.appInstallations)
        .values({ organizationId, applicationId })
        .returning({ id: schema.appInstallations.id });
      await transaction.insert(schema.appClients).values({
        installationId,
        clientId: client.client_id,
      });
      const session = await auth.api.getSession({ headers });
      if (!session) {
        throw new APIError('UNAUTHORIZED');
      }

      await transaction.insert(schema.appAccessEvents).values({
        actorId: session.user.id,
        installationId,
        action: 'application.registered',
        details: {
          applicationId,
          clientId: client.client_id,
          tokenEndpointAuthMethod,
        },
      });
      return {
        applicationId,
        installationId,
        clientId: client.client_id,
        clientSecret: client.client_secret,
        tokenEndpointAuthMethod,
      };
    });
  });
}
