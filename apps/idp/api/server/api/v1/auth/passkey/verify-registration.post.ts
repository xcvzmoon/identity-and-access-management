import { defineHandler } from 'nitro';
import { finishPasskey } from '../../../../services/passkey.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return finishPasskey(event, 'registration');
});
