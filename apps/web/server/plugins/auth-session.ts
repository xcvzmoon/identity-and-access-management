import { createError } from 'nuxt/server';
import { resolveApiSession } from '../utils/api-session';

export default function registerAuthSessionHooks(): void {
  sessionHooks.hook('fetch', async (session, event) => {
    const user = await resolveApiSession(event);
    if (!user) {
      await clearUserSession(event);
      throw createError({
        status: 401,
        message: 'Authentication required',
      });
    }

    session.user = user;
  });
}
