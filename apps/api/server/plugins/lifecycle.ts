import { useAuth } from '@iam/auth';
import { useDatabase } from '@iam/database';
import { definePlugin } from 'nitro';

export default definePlugin((app) => {
  useAuth();

  // Nitro awaits promises returned by close hooks despite the void callback type.
  // oxlint-disable-next-line typescript/strict-void-return
  app.hooks.hook('close', async () => {
    await useDatabase().$client.end();
  });
});
