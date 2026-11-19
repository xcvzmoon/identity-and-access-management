import { defineHandler } from 'nitro';
import { beginLogin } from '../../services/auth.service.ts';

export default defineHandler(async (event) => {
  return beginLogin(event);
});
