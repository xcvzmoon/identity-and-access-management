import { defineHandler } from 'nitro';
import { startPasskey } from '../../../../services/passkey.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return startPasskey(event, 'registration');
});
