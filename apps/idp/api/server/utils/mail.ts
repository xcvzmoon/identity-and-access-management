import { log } from 'evlog';
import { type Transporter, createTransport } from 'nodemailer';
import * as valibot from 'valibot';
import { useEnv } from './env.ts';

type AccountEmailBacklog = { pendingDeliveries: number; oldestPendingMs: number };

type DeliveryFailure =
  | { reason: 'submission_deadline' | 'delivery_error' }
  | { reason: 'smtp_reply'; smtpResponseCode: number };

const EMPTY_AGE_MS = 0;
const IMPLICIT_TLS_PORT = 465;
const MAX_CONCURRENT_DELIVERIES = 8;
const MIN_SMTP_REPLY = 200;
const MAX_SMTP_REPLY = 599;

const smtpErrorSchema = valibot.object({
  code: valibot.optional(valibot.string()),
  responseCode: valibot.optional(
    valibot.pipe(
      valibot.number(),
      valibot.integer(),
      valibot.minValue(MIN_SMTP_REPLY),
      valibot.maxValue(MAX_SMTP_REPLY),
    ),
  ),
});

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

function deliveryFailureDetails(cause: unknown): DeliveryFailure {
  const parsed = valibot.safeParse(smtpErrorSchema, cause);
  if (parsed.success && parsed.output.code === 'EABORT') {
    return { reason: 'submission_deadline' };
  }
  if (parsed.success && parsed.output.responseCode) {
    return {
      reason: 'smtp_reply',
      smtpResponseCode: parsed.output.responseCode,
    };
  }
  return { reason: 'delivery_error' };
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
  const started = performance.now();
  const sending = smtp.sendMail({
    ...(mode === 'confirmed' && { signal: AbortSignal.timeout(env.smtp.confirmedTimeoutMs) }),
    from: env.smtp.from,
    to,
    subject,
    text: `${subject}\n\n${url}\n\nIf you did not request this email, you can ignore it.`,
  });

  function reportFailure(cause: unknown): void {
    log.error({
      event: 'account-email-delivery',
      outcome: 'failed',
      delivery: mode,
      elapsedMs: Math.floor(performance.now() - started),
      ...deliveryFailureDetails(cause),
    });
  }

  const delivery = sending.catch(reportFailure).finally(() => {
    pending.delete(delivery);
  });

  pending.set(delivery, started);
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
