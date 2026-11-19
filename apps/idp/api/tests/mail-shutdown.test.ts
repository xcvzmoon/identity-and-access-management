import type { Server, Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import * as valibot from 'valibot';
import { expect, test, vi } from 'vite-plus/test';
import { initializeEnv } from '../server/utils/env.ts';
import {
  finishAccountEmail,
  getAccountEmailBacklog,
  sendAccountEmail,
} from '../server/utils/mail.ts';

const EPHEMERAL_PORT = 0;
const RELAY_DELAY_MS = 20;
const NO_PENDING_AGE = 0;
const ONE_DELIVERY = 1;
const TWO_DELIVERIES = 2;
const EMPTY_BACKLOG = {
  pendingDeliveries: 0,
  oldestPendingMs: 0,
};

function initializeFixtureEnv(port: number): void {
  const settings = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USER: 'fixture',
    DB_PASSWORD: randomUUID(),
    DB_DATABASE: 'fixture',
    DB_SSL: 'false',
    DB_LOGGER: 'false',
    TRUST_PROXY_IP: 'false',
    OIDC_ISSUER_URL: 'https://issuer.example.test',
    BETTER_AUTH_SECRET: randomUUID(),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_FROM: 'issuer@example.test',
    SMTP_USER: 'fixture',
    SMTP_PASSWORD: randomUUID(),
    OPERATOR_USER_IDS: '',
  };
  for (const [key, value] of Object.entries(settings)) {
    vi.stubEnv(key, value);
  }
  initializeEnv();
}

async function nextConnection(server: Server): Promise<Socket> {
  return new Promise((resolve) => {
    server.once('connection', resolve);
  });
}

async function checkPendingDeliveries(server: Server): Promise<void> {
  const first = nextConnection(server);
  const sending = sendAccountEmail(
    'owner@example.test',
    'Test invitation',
    'https://issuer.example.test/invite',
    'confirmed',
  );
  const rejected = expect(sending).rejects.toThrow();
  const confirmed = await first;
  try {
    const second = nextConnection(server);
    await sendAccountEmail(
      'user@example.test',
      'Test verification',
      'https://issuer.example.test/verify',
    );
    const queued = await second;
    try {
      let drained = false;
      const shutdown = finishAccountEmail().then(() => {
        drained = true;
      });
      await delay(RELAY_DELAY_MS);
      const backlog = getAccountEmailBacklog();
      expect(backlog.pendingDeliveries).toBe(TWO_DELIVERIES);
      expect(backlog.oldestPendingMs).toBeGreaterThan(NO_PENDING_AGE);
      expect(drained).toBe(false);
      queued.end('421 Temporary relay failure\r\n');
      await expect.poll(() => getAccountEmailBacklog().pendingDeliveries).toBe(ONE_DELIVERY);
      expect(drained).toBe(false);
      confirmed.end('421 Temporary relay failure\r\n');
      await rejected;
      await shutdown;
      expect(drained).toBe(true);
    } finally {
      queued.destroy();
    }
  } finally {
    confirmed.destroy();
    await rejected;
  }
}

test('shutdown waits for confirmed SMTP delivery and propagates a relay rejection', async () => {
  const server = createServer();
  const listening = once(server, 'listening');
  server.listen(EPHEMERAL_PORT, '127.0.0.1');
  await listening;
  const address = valibot.parse(valibot.object({ port: valibot.number() }), server.address());

  try {
    initializeFixtureEnv(address.port);
    expect(getAccountEmailBacklog()).toEqual(EMPTY_BACKLOG);
    await checkPendingDeliveries(server);
    expect(getAccountEmailBacklog()).toEqual(EMPTY_BACKLOG);
  } finally {
    await finishAccountEmail();
    await server[Symbol.asyncDispose]();
    vi.unstubAllEnvs();
  }
});
