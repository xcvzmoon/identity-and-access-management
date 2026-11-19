import { defineHandler } from 'nitro';
import { forwardConsent } from '../../../../services/consent.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return forwardConsent(event);
});
