import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import * as valibot from 'valibot';

const DISCOVERY_TIMEOUT_MS = 10_000;

const documents = [
  'docs/client-integration.md',
  'docs/local.md',
  'docs/architecture.md',
  'docs/signing-key-rotation.md',
  'examples/reference-app/server.ts',
];
const endpoint = valibot.pipe(valibot.string(), valibot.url(), valibot.startsWith('https://'));
const metadataSchema = valibot.looseObject({
  issuer: endpoint,
  authorization_endpoint: endpoint,
  token_endpoint: endpoint,
  jwks_uri: endpoint,
  introspection_endpoint: endpoint,
});
const server = new McpServer({
  name: 'iam-integration',
  version: '1.0.0',
});

async function readDocument(file: string): Promise<string> {
  return readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
}

for (const file of documents) {
  const mimeType = file.endsWith('.md') ? 'text/markdown' : 'text/plain';

  server.registerResource(file, `iam://project/${file}`, { mimeType }, async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType,
        text: await readDocument(file),
      },
    ],
  }));
}

server.registerTool(
  'read_integration_guide',
  {
    description:
      'Read the IAM integration guide for client registration, PKCE, callbacks, and permission checks.',
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: await readDocument('docs/client-integration.md'),
      },
    ],
  }),
);

server.registerTool(
  'get_issuer_metadata',
  {
    description: 'Fetch public OpenID Connect discovery metadata from the configured IAM issuer.',
    annotations: { readOnlyHint: true },
  },
  async (extra) => {
    const issuer = process.env.OIDC_ISSUER_URL;
    if (!issuer || !URL.canParse(issuer)) {
      throw new Error('Set OIDC_ISSUER_URL to the canonical HTTPS issuer origin.');
    }

    const url = new URL(issuer);
    if (url.protocol !== 'https:' || url.origin !== issuer) {
      throw new Error('OIDC_ISSUER_URL must be a bare HTTPS origin without a trailing slash.');
    }

    const response = await fetch(new URL('/.well-known/openid-configuration', url), {
      redirect: 'error',
      signal: AbortSignal.any([extra.signal, AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)]),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Issuer discovery returned HTTP ${response.status}.`);
    }

    const metadata = valibot.parse(metadataSchema, await response.json());
    if (metadata.issuer !== issuer) {
      throw new Error('Discovery metadata does not match the configured issuer.');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metadata),
        },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
