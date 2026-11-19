import { log } from 'evlog';
import { definePlugin } from 'nitro';
import { useDatabase } from '../database/index.ts';
import { deliverNextInvitation } from '../services/invitation-delivery.service.ts';
import { checkDbConnection } from '../utils/database.ts';
import { initializeEnv } from '../utils/env.ts';
import { finishAccountEmail } from '../utils/mail.ts';

const DELIVERY_POLL_MS = 2000;

function startWorker(kind: 'owner' | 'member'): () => Promise<void> {
  let delivery: Promise<void> | null = null;

  function poll(): void {
    delivery ??= deliverNextInvitation(kind)
      .catch(() => {
        log.error({
          event: `${kind}-invitation-delivery-attempt`,
          outcome: 'failed',
        });
      })
      .finally(() => {
        delivery = null;
      });
  }

  const timer = setInterval(poll, DELIVERY_POLL_MS);
  timer.unref();
  poll();

  return async () => {
    clearInterval(timer);
    await delivery;
  };
}

export default definePlugin(async (app): Promise<void> => {
  initializeEnv();
  const workers: (() => Promise<void>)[] = [];

  // Register cleanup before probing so shutdown can close the pool even if the probe fails.
  app.hooks.hook('close', async () => {
    await Promise.all(workers.map(async (stop) => stop()));
    try {
      const database = useDatabase();
      await database.$client.end();
    } finally {
      await finishAccountEmail();
    }
  });

  await checkDbConnection();
  workers.push(startWorker('owner'), startWorker('member'));
});
