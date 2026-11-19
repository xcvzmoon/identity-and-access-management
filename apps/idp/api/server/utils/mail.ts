import type { Transporter } from 'nodemailer';
import { log } from 'evlog';
import { useEnv } from './env.ts';

const IMPLICIT_TLS_PORT = 465;
const MAX_CONCURRENT_DELIVERIES = 8;

let transport: Transporter | null = null;
const pending = new Set<Promise<unknown>>();

async function mailTransport(): Promise<Transporter> {
  if (transport) {
    return transport;
  }

  const nodemailer = await import('nodemailer');
  const env = useEnv();
  const smtp = env.smtp;

  transport ??= nodemailer.createTransport({
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
  const smtp = await mailTransport();
  const sending = smtp.sendMail({
    from: env.smtp.from,
    to,
    subject,
    text: `${subject}\n\n${url}\n\nIf you did not request this email, you can ignore it.`,
  });

  if (mode === 'confirmed') {
    try {
      await sending;
    } catch (error) {
      logDeliveryFailure(mode);
      throw error;
    }

    return;
  }

  const delivery = sending
    .catch(() => {
      logDeliveryFailure(mode);
    })
    .finally(() => {
      pending.delete(delivery);
    });

  pending.add(delivery);
}

export async function finishAccountEmail(): Promise<void> {
  await Promise.all(pending);
  transport?.close();
}
