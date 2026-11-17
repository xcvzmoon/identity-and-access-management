import { useAuth } from '@iam/auth';
import { defineHandler } from 'nitro';

export default defineHandler(async (event) => {
  return useAuth().handler(event.req);
});
