import { log } from 'evlog';
import { definePlugin } from 'nitro';
import { useDatabase } from '../database/index.ts';
import { deliverNextOwnerInvitation } from '../services/owner-invitation-delivery.service.ts';
import { checkDbConnection } from '../utils/database.ts';
import { initializeEnv } from '../utils/env.ts';
import { finishAccountEmail } from '../utils/mail.ts';

const DELIVERY_POLL_MS = 2000;

export default definePlugin(async (app): Promise<void> => {
  initializeEnv();
  let timer: ReturnType<typeof setInterval> | null = null;
  let delivery: Promise<void> | null = null;

  function poll(): void {
    delivery ??= deliverNextOwnerInvitation()
      .catch(() => {
        log.error({
          event: 'owner-invitation-delivery-attempt',
          outcome: 'failed',
        });
      })
      .finally(() => {
        delivery = null;
      });
  }

  // Register cleanup before probing so shutdown can close the pool even if the probe fails.
  app.hooks.hook('close', async () => {
    if (timer) {
      clearInterval(timer);
    }
    await delivery;
    try {
      const database = useDatabase();
      await database.$client.end();
    } finally {
      await finishAccountEmail();
    }
  });

  await checkDbConnection();
  timer = setInterval(poll, DELIVERY_POLL_MS);
  timer.unref();
  poll();
});
