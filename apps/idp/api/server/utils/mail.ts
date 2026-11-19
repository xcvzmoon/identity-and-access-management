import { log } from 'evlog';
import { type Transporter, createTransport } from 'nodemailer';
import { useEnv } from './env.ts';

type AccountEmailBacklog = { pendingDeliveries: number; oldestPendingMs: number };

const EMPTY_AGE_MS = 0;
const IMPLICIT_TLS_PORT = 465;
const MAX_CONCURRENT_DELIVERIES = 8;

let transport: Transporter | null = null;
const pending = new Map<Promise<unknown>, number>();

function mailTransport(): Transporter {
  if (transport) {
    return transport;
  }

  const env = useEnv();
  const smtp = env.smtp;

  transport = createTransport({
    pool: true,
    maxConnections: MAX_CONCURRENT_DELIVERIES,
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === IMPLICIT_TLS_PORT,
    requireTLS: !['localhost', '127.0.0.1', '::1'].includes(smtp.host),
    ...(smtp.user && {
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    }),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return transport;
}

function logDeliveryFailure(delivery: 'queued' | 'confirmed'): void {
  log.error({
    event: 'account-email-delivery',
    outcome: 'failed',
    delivery,
  });
}

/** Sends an account link. Confirmed delivery propagates SMTP errors to the caller.
 * @param {string} to - Recipient address.
 * @param {string} subject - Email subject.
 * @param {string} url - Account action link.
 * @param {'queued' | 'confirmed'} [mode] - Whether to wait for SMTP acceptance.
 */
export async function sendAccountEmail(
  to: string,
  subject: string,
  url: string,
  mode: 'queued' | 'confirmed' = 'queued',
): Promise<void> {
  const env = useEnv();
  const smtp = mailTransport();
  const sending = smtp.sendMail({
    from: env.smtp.from,
    to,
    subject,
    text: `${subject}\n\n${url}\n\nIf you did not request this email, you can ignore it.`,
  });

  const delivery = sending
    .catch(() => {
      logDeliveryFailure(mode);
    })
    .finally(() => {
      pending.delete(delivery);
    });

  pending.set(delivery, performance.now());
  if (mode === 'confirmed') {
    await sending;
  }
}

/**
 * Reads the count and age of unfinished SMTP submissions in this IdP process.
 * @returns {AccountEmailBacklog} Age in monotonic milliseconds, or zero when the pool has no pending deliveries.
 */
export function getAccountEmailBacklog(): AccountEmailBacklog {
  const oldest = pending.values().next();
  return {
    pendingDeliveries: pending.size,
    oldestPendingMs: oldest.done ? EMPTY_AGE_MS : Math.floor(performance.now() - oldest.value),
  };
}

/** Waits for deliveries already submitted and closes their SMTP pool. Later sends use a new pool. */
export async function finishAccountEmail(): Promise<void> {
  const draining = transport;

  transport = null;
  await Promise.allSettled(pending.keys());
  draining?.close();
}
