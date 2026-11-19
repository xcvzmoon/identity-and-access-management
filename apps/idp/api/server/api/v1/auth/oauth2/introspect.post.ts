import { defineHandler } from 'nitro';
import { introspectAppAccess } from '../../../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return introspectAppAccess(event);
});
