import type { Auth } from './auth.ts';
import { useDatabase } from '@iam/database';
import { createAccountMailer } from './account-email.ts';
import { createAuth } from './auth.ts';
import { useAuthEnv } from './env.ts';

let auth: Auth | null = null;

/**
 * Returns the shared Better Auth server, initializing it once on the first call.
 * Local configuration comes from the auth workspace's .env. Other environments
 * use process variables. The database connection is shared with useDatabase().
 *
 * @returns {Auth} Configured Better Auth server.
 * @throws {Error} When authentication or database configuration is invalid.
 */
export function useAuth(): Auth {
  if (!auth) {
    const { smtpUrl, smtpFrom, ...options } = useAuthEnv();
    const database = useDatabase();

    if (smtpUrl) {
      const mail = createAccountMailer(smtpUrl, smtpFrom);
      auth = createAuth(database, {
        ...options,
        sendPasswordRecoveryEmail: async (message) =>
          mail({
            ...message,
            purpose: 'password-recovery',
          }),
        sendOrganizationInvitation: async (message) =>
          mail({
            ...message,
            purpose: 'organization-invitation',
            accountUrl: new URL('/account', options.webOrigin).href,
          }),
      });
    } else {
      auth = createAuth(database, options);
    }
  }

  return auth;
}
