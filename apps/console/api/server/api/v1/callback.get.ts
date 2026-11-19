import { defineHandler } from 'nitro';
import { finishLogin } from '../../services/auth.service.ts';

export default defineHandler(async (event) => {
  return finishLogin(event);
});
