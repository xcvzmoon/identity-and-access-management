import type { User } from '@iam/shared/types';
import { selectUserSchema } from '@iam/shared/types';
import { createAuthClient } from 'better-auth/vue';
import * as valibot from 'valibot';
import { authSessionKey } from '../constants/auth';

type SessionUser = Pick<User, 'id' | 'name' | 'email'>;

const sessionUserSchema = valibot.pick(selectUserSchema, ['id', 'name', 'email']);
const unauthorized = 401;

export default defineNuxtPlugin({
  dependsOn: ['api'],
  setup: async () => {
    type Session = typeof auth.$Infer.Session;

    const runtimeConfig = useRuntimeConfig();
    const auth = createAuthClient({ baseURL: runtimeConfig.public.apiUrl });

    useRequestEvent()?.res.headers.set('Cache-Control', 'no-store');

    const session = await auth.useSession(async (url, options) => {
      const result = await useApi(url, {
        ...options,
        key: authSessionKey,
        transform: (data: Session | null) => ({
          user: data ? valibot.parse(sessionUserSchema, data.user) : null,
        }),
        dedupe: 'defer',
      });

      if (result.error.value && result.error.value.status !== unauthorized) {
        throw createError({
          status: 503,
          message: 'Authentication unavailable',
        });
      }

      return result;
    });

    const user = computed<SessionUser | null>(() => session.data.value?.user ?? null);

    return {
      provide: {
        auth,
        authUser: user,
        refreshAuthSession: async (): Promise<void> => refreshNuxtData(authSessionKey),
      },
    };
  },
});
