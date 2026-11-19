import { defineHandler } from 'nitro';
import { inviteOwner } from '../../../services/operator.service.ts';

export default defineHandler(async (event): Promise<Response> => inviteOwner(event));
