import { defineHandler } from 'nitro';
import { manageOrganization } from '../../services/auth.service.ts';

export default defineHandler(async (event) => {
  return manageOrganization(event);
});
