import { defineHandler } from 'nitro';
import { authenticate } from '../utils/browser-auth.ts';

export default defineHandler(async (event) => authenticate(event, 'sign-up'));
