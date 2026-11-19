import { defineHandler } from 'nitro';
import { signInWithPassword } from '../../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return signInWithPassword(event, 'api');
});
