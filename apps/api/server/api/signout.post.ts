import { defineHandler } from 'nitro';
import { signOut } from '../utils/browser-auth.ts';

export default defineHandler(async (event) => signOut(event));
