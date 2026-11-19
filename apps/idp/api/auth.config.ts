import { useAuth } from './server/utils/auth.ts';
import { initializeEnv } from './server/utils/env.ts';

initializeEnv();

export const auth = useAuth();
