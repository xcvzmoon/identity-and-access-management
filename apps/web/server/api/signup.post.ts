import { defineHandler } from 'nuxt/server';
import { authenticate } from '../utils/authenticate';

export default defineHandler(async (event) => {
  await authenticate(event, 'sign-up');
  return {};
});
