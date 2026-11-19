import { defineHandler } from 'nitro';
import { signOut } from '../../services/auth.service.ts';

export default defineHandler(async (event) => {
  return signOut(event);
});
