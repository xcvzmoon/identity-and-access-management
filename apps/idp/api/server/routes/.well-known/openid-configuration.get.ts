import { defineHandler } from 'nitro';
import { getIssuerMetadata } from '../../services/auth.service.ts';

export default defineHandler(async (event): Promise<Response> => {
  return getIssuerMetadata(event);
});
