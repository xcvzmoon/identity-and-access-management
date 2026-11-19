import { defineHandler } from 'nitro';
import { forwardOAuthFormRequest } from '../../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return forwardOAuthFormRequest(event);
});
