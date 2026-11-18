import { H3 } from 'nitro/h3';
import { expect, test } from 'vite-plus/test';
import authHandler from '../server/api/auth/[...all].ts';

const app = new H3().all('/api/auth/**', authHandler);
const notFound = 404;
const apiUrl = 'http://localhost:3000';

test.each([
  'admin/oauth2/create-client',
  'oauth2/register',
  'api-key/create',
  'organization/create',
  'organization/invite-member',
  'organization/accept-invitation',
  'organization/update-member-role',
  'organization/remove-member',
  'organization/leave',
  'organization/cancel-invitation',
  'email-otp/send-verification-otp',
  'email-otp/verify-email',
  'account/email-verification',
  'email-otp/request-password-reset',
  'email-otp/reset-password',
  'request-password-reset',
  'reset-password',
  'sign-in/email-otp',
  'sign-in/email/',
  'change-password',
  'set-password',
  'update-user',
  'revoke-session',
  'revoke-sessions',
  'revoke-other-sessions',
])('rejects POST to an unlisted auth endpoint: %s', async (path) => {
  const response = await app.fetch(
    new Request(`${apiUrl}/api/auth/${path}`, {
      method: 'POST',
    }),
  );
  expect(response.status).toBe(notFound);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test.each(['list-sessions', 'list-accounts'])(
  'rejects GET to the internal auth endpoint: %s',
  async (path) => {
    const response = await app.fetch(new Request(`${apiUrl}/api/auth/${path}`));
    expect(response.status).toBe(notFound);
    expect(response.headers.get('cache-control')).toBe('no-store');
  },
);
