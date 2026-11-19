import { defineHandler } from 'nitro';
import { signOutIam } from '../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return signOutIam(event);
});
