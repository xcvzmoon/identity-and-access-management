import { log } from 'evlog';
import { definePlugin } from 'nitro';
import { getAccountEmailBacklog } from '../utils/mail.ts';

const SAMPLE_INTERVAL_MS = 60_000;

function reportBacklog(): void {
  log.info({
    event: 'account-email-backlog',
    ...getAccountEmailBacklog(),
  });
}

export default definePlugin((app) => {
  const timer = setInterval(reportBacklog, SAMPLE_INTERVAL_MS);
  timer.unref();
  reportBacklog();

  app.hooks.hook('close', () => {
    clearInterval(timer);
  });
});
