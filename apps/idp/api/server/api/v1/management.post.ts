import { defineHandler } from 'nitro';
import { manageOrganization } from '../../services/management.service.ts';

export default defineHandler(async (event): Promise<Response> => manageOrganization(event));
