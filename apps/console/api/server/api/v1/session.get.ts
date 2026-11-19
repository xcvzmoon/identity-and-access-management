import { defineHandler } from 'nitro';
import { getSession } from '../../services/auth.service.ts';

export default defineHandler(async (event) => {
  return getSession(event);
});
