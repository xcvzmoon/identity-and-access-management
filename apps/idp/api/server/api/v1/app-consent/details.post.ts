import { defineHandler } from 'nitro';
import { consentDetails } from '../../../services/consent.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return consentDetails(event);
});
