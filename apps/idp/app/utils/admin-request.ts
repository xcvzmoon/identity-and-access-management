import * as valibot from 'valibot';

export const adminInteractionEndpoint = '/api/auth/admin/interaction';

const tooManyRequests = 429;
const errorData = valibot.object({ code: valibot.optional(valibot.string()) });
export const adminErrorSchema = valibot.object({
  data: valibot.optional(errorData),
  statusCode: valibot.optional(valibot.number()),
});

type AdminRequestError = valibot.InferOutput<typeof adminErrorSchema>;

export function adminRequestMessage(failure: AdminRequestError | null, fallback: string): string {
  if (failure?.statusCode === tooManyRequests) {
    return 'Too many admin requests. Wait a minute and try again.';
  }

  const code = failure?.data?.code;
  if (code === 'APP_ACCESS_FORBIDDEN') {
    return 'You no longer have permission to manage this app.';
  }

  if (code === 'APP_MEMBER_UNAVAILABLE') {
    return 'This member is no longer eligible for app access.';
  }

  if (code === 'APP_ROLE_NOT_FOUND' || code === 'APP_PERMISSION_NOT_FOUND') {
    return 'A selected role or permission is unavailable. Reload the app and try again.';
  }

  return fallback;
}
