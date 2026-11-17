import { defineHandler } from 'nuxt/server';
import { signOut } from '../utils/authenticate';

export default defineHandler(async (event) => {
  await signOut(event);
  return {};
});
