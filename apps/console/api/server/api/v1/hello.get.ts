import { defineHandler } from 'nitro';
import { getGreeting } from '../../services/hello.service.ts';

export default defineHandler(() => {
  return getGreeting();
});
