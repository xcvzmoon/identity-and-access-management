import { definePlugin } from 'nitro';
import { rotateSigningKeys } from '../services/signing-key.service.ts';

const RETRY_INTERVAL_MS = 60_000;

async function tick(): Promise<void> {
  try {
    const result = await rotateSigningKeys();
    if (result) {
      console.info(
        JSON.stringify({
          event: 'signing-key-rotation',
          ...result,
        }),
      );
    }
  } catch {
    console.error(
      JSON.stringify({
        event: 'signing-key-rotation',
        outcome: 'failed',
      }),
    );
  }
}

export default definePlugin((app) => {
  let running: Promise<void> | null = null;

  function start(): void {
    running ??= tick().finally(() => {
      running = null;
    });
  }

  const timer = setInterval(start, RETRY_INTERVAL_MS);
  timer.unref();
  start();

  app.hooks.hook('close', async () => {
    clearInterval(timer);
    await running;
  });
});
