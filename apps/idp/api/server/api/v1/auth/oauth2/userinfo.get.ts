import { defineHandler } from 'nitro';
import { forwardGetRequestToBetterAuth } from '../../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return forwardGetRequestToBetterAuth(event);
});
