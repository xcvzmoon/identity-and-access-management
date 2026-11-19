import type { ComputedRef } from 'vue';
import * as valibot from 'valibot';

const userSchema = valibot.object({
  id: valibot.string(),
  name: valibot.string(),
  email: valibot.string(),
  emailVerified: valibot.boolean(),
});
const responseSchema = valibot.nullable(valibot.object({ user: userSchema }));
const unauthorized = 401;
const unavailable = 503;

type SessionUser = valibot.InferOutput<typeof userSchema>;
type UserSession = {
  user: ComputedRef<SessionUser | null>;
  loggedIn: ComputedRef<boolean>;
  refresh: () => Promise<void>;
  clear: () => void;
};

export function useUserSession(): UserSession {
  const { webOrigin } = useRuntimeConfig().public;
  const currentUser = useState<SessionUser | null>('iam-session-user', () => null);

  function clear(): void {
    currentUser.value = null;
  }

  async function refresh(): Promise<void> {
    try {
      const response = await fetch(new URL('/api/auth/get-session', webOrigin), {
        cache: 'no-store',
        credentials: 'include',
        redirect: 'error',
      });

      if (response.status === unauthorized) {
        clear();
        return;
      }

      if (!response.ok) {
        throw createError({
          status: unavailable,
          message: 'Authentication unavailable',
        });
      }

      const session = valibot.parse(responseSchema, await response.json());
      currentUser.value = session?.user ?? null;
    } catch (error) {
      clear();
      throw error;
    }
  }

  return {
    user: computed<SessionUser | null>(() => currentUser.value),
    loggedIn: computed<boolean>(() => currentUser.value !== null),
    refresh,
    clear,
  };
}
