import type { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setImmediate } from 'node:timers/promises';
import * as valibot from 'valibot';
import { expect, test, vi } from 'vite-plus/test';
import { initializeEnv } from '../server/utils/env.ts';
import { finishAccountEmail, sendAccountEmail } from '../server/utils/mail.ts';

const EPHEMERAL_PORT = 0;

test('shutdown waits for confirmed SMTP delivery and propagates a relay rejection', async () => {
  const connected = Promise.withResolvers<Socket>();
  const server = createServer((socket) => {
    connected.resolve(socket);
  });
  const listening = once(server, 'listening');
  server.listen(EPHEMERAL_PORT, '127.0.0.1');
  await listening;
  const address = valibot.parse(valibot.object({ port: valibot.number() }), server.address());
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
    SMTP_PORT: String(address.port),
    SMTP_FROM: 'issuer@example.test',
    SMTP_USER: 'fixture',
    SMTP_PASSWORD: randomUUID(),
    OPERATOR_USER_IDS: '',
  };

  try {
    for (const [key, value] of Object.entries(settings)) {
      vi.stubEnv(key, value);
    }
    initializeEnv();
    const sending = sendAccountEmail(
      'owner@example.test',
      'Test invitation',
      'https://issuer.example.test/invite',
      'confirmed',
    );
    const rejected = expect(sending).rejects.toThrow();
    const socket = await connected.promise;
    try {
      let drained = false;
      const shutdown = finishAccountEmail().then(() => {
        drained = true;
      });
      await setImmediate();
      expect(drained).toBe(false);
      socket.end('421 Temporary relay failure\r\n');
      await rejected;
      await shutdown;
      expect(drained).toBe(true);
    } finally {
      socket.destroy();
      await rejected;
    }
  } finally {
    await finishAccountEmail();
    await server[Symbol.asyncDispose]();
    vi.unstubAllEnvs();
  }
});
