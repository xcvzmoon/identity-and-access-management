import type { ChildProcess } from 'node:child_process';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect } from 'vite-plus/test';

type Client = { clientId: string; clientSecret: string };
type Cluster = {
  appOrigin: string;
  consoleOrigin: string;
  startConsole: (client: Client) => Promise<void>;
  startApp: (client: Client) => Promise<void>;
  setIntrospectionAvailable: (available: boolean) => void;
  close: () => Promise<void>;
};

const LOOPBACK = '127.0.0.1';
const PRIMARY_OFFSET = 1;
const REPLICA_OFFSET = 2;
const WEB_OFFSET = 3;
const APP_OFFSET = 4;
const CONSOLE_API_OFFSET = 5;
const CONSOLE_WEB_OFFSET = 6;
const STARTUP_TIMEOUT = 20_000;
const SUCCESS = 200;
const UNAVAILABLE = 503;

async function start(
  processes: ChildProcess[],
  script: string,
  port: number,
  env: NodeJS.ProcessEnv = {},
): Promise<void> {
  const probe = createTcpServer();
  probe.listen(port, LOOPBACK);
  await once(probe, 'listening');
  await probe[Symbol.asyncDispose]();

  const child = spawn(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
      HOST: LOOPBACK,
      PORT: String(port),
    },
  });
  processes.push(child);

  const ready = expect
    .poll(
      async () => {
        const response = await fetch(`http://${LOOPBACK}:${port}`);
        return response.status;
      },
      {
        timeout: STARTUP_TIMEOUT,
      },
    )
    .toBeLessThan(UNAVAILABLE);
  const listener = new AbortController();

  try {
    await Promise.race([
      ready,
      once(child, 'exit', { signal: listener.signal }).then(([code]) => {
        throw new Error(`Fixture process ${script} exited during startup (${code}).`);
      }),
    ]);
  } finally {
    listener.abort();
  }
}

async function startConsole(
  processes: ChildProcess[],
  issuerPort: number,
  consoleOrigin: string,
  client: Client,
): Promise<void> {
  await start(
    processes,
    '../../../../console/api/.output/server/index.mjs',
    issuerPort + CONSOLE_API_OFFSET,
    {
      CONSOLE_ORIGIN: consoleOrigin,
      DB_USER: 'iam_console_runtime',
      DB_PASSWORD: process.env.IAM_PHASE6_CONSOLE_DB_PASSWORD,
      OIDC_CLIENT_SECRET: client.clientSecret,
    },
  );
  await start(
    processes,
    '../../../../console/web/.output/server/index.mjs',
    issuerPort + CONSOLE_WEB_OFFSET,
  );
}

/**
 * Starts two built IdP servers sharing one issuer, a web UI, and a TLS proxy.
 * The proxy sends all introspection requests to the replica and sign-out to the primary.
 * @param {URL} issuer - Loopback HTTPS origin shared by both API processes.
 * @returns {Promise<Cluster>} Running servers and their cleanup operation.
 */
export async function startCluster(issuer: URL): Promise<Cluster> {
  const key = process.env.IAM_PHASE6_TLS_KEY ?? process.env.IAM_PHASE5_TLS_KEY;
  const certificate = process.env.NODE_EXTRA_CA_CERTS;
  assert.ok(key && certificate);
  assert.equal(issuer.hostname, 'localhost');
  assert.ok(issuer.port);

  const issuerPort = Number(issuer.port);
  const appOrigin = `https://reports.localhost:${issuerPort}`;
  const consoleOrigin = `https://console.localhost:${issuerPort}`;
  const processes: ChildProcess[] = [];
  let introspectionAvailable = true;

  const proxy = createServer(
    {
      key: readFileSync(key),
      cert: readFileSync(certificate),
    },
    (incoming, outgoing) => {
      const path = incoming.url ?? '/';
      const introspection = path === '/api/v1/auth/oauth2/introspect';
      if (introspection && !introspectionAvailable) {
        outgoing.writeHead(UNAVAILABLE).end();
        return;
      }

      let offset = WEB_OFFSET;
      if (incoming.headers.host === new URL(appOrigin).host) {
        offset = APP_OFFSET;
      } else if (incoming.headers.host === new URL(consoleOrigin).host) {
        offset = path.startsWith('/api/') ? CONSOLE_API_OFFSET : CONSOLE_WEB_OFFSET;
      } else if (introspection) {
        offset = REPLICA_OFFSET;
      } else if (path.startsWith('/api/') || path.startsWith('/.well-known/')) {
        offset = PRIMARY_OFFSET;
      }

      const upstream = request(
        {
          host: LOOPBACK,
          port: issuerPort + offset,
          path,
          method: incoming.method,
          headers: incoming.headers,
        },
        (response) => {
          outgoing.writeHead(response.statusCode ?? UNAVAILABLE, response.headers);
          response.pipe(outgoing);
        },
      );

      upstream.on('error', () => outgoing.writeHead(UNAVAILABLE).end());
      incoming.pipe(upstream);
    },
  );

  async function close(): Promise<void> {
    proxy.closeAllConnections();
    if (proxy.listening) {
      await proxy[Symbol.asyncDispose]();
    }

    await Promise.all(
      processes.map(async (child) => {
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = once(child, 'exit');
          child.kill();
          await stopped;
        }
      }),
    );
  }

  try {
    proxy.listen(issuerPort, LOOPBACK);
    await once(proxy, 'listening');
    await start(processes, '../../.output/server/index.mjs', issuerPort + PRIMARY_OFFSET);
    await start(processes, '../../.output/server/index.mjs', issuerPort + REPLICA_OFFSET);
    await start(processes, '../../../web/.output/server/index.mjs', issuerPort + WEB_OFFSET);
    const discovery = await fetch(new URL('/.well-known/openid-configuration', issuer));
    expect(discovery.status).toBe(SUCCESS);

    return {
      appOrigin,
      consoleOrigin,
      startConsole: async (client) => startConsole(processes, issuerPort, consoleOrigin, client),
      async startApp(client) {
        await start(
          processes,
          '../../../../../examples/reference-app/server.ts',
          issuerPort + APP_OFFSET,
          {
            APP_ORIGIN: appOrigin,
            CLIENT_ID: client.clientId,
            CLIENT_SECRET: client.clientSecret,
          },
        );
      },
      setIntrospectionAvailable(available) {
        introspectionAvailable = available;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
