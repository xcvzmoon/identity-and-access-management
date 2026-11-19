import { defineHandler } from 'nitro';
import { forwardPostRequestToBetterAuth } from '../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return forwardPostRequestToBetterAuth(event, 'omit');
});
