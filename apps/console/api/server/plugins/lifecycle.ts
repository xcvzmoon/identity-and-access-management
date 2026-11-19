import { definePlugin } from 'nitro';
import { useDatabase } from '../database/index.ts';
import { checkDbConnection } from '../utils/database.ts';
import { initializeEnv } from '../utils/env.ts';

export default definePlugin(async (app): Promise<void> => {
  initializeEnv();

  // Register cleanup before probing so shutdown can close the pool even if the probe fails.
  app.hooks.hook('close', async () => {
    const database = useDatabase();
    await database.$client.end();
  });

  await checkDbConnection();
});
