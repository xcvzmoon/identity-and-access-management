import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs, parseEnv } from 'node:util';

type CreationMode = 'preserve' | 'recreate';

type EnvFile = {
  destination: string;
  existing: string | null;
  contents: string;
};

const rootDirectory = path.resolve(import.meta.dirname, '..');
const privateFileMode = 0o600;
const privateDirectoryMode = 0o700;
const minPort = 1;
const maxPort = 65_535;
const databaseExample = path.join('packages', 'database', '.env.example');

function generateSecret(): string {
  return execFileSync('openssl', ['rand', '-base64', '32'], { encoding: 'utf8' }).trim();
}

function isPortableEnvValue(value: string): boolean {
  return (
    parseEnv(`VALUE="${value}"`).VALUE === value &&
    !/\$(?:[$A-Za-z_]|\{)|\\(?:[abfnrtv\\"]|$)/u.test(value)
  );
}

function isDatabasePort(value: string): boolean {
  const port = Number(value);
  return /^\d+$/u.test(value) && port >= minPort && port <= maxPort;
}

async function promptDatabaseEnv(template: string): Promise<string> {
  let hidden = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done): void {
      if (!hidden) {
        process.stdout.write(chunk);
      }
      done();
    },
  });
  const terminal = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const cancellation = new AbortController();
  terminal.once('close', () => {
    cancellation.abort();
  });

  async function ask(
    label: string,
    fallback = '',
    mode: 'visible' | 'hidden' = 'visible',
  ): Promise<string> {
    const question = fallback ? `${label} [${fallback}]: ` : `${label}: `;
    const secret = mode === 'hidden';
    if (secret) {
      hidden = true;
    }
    try {
      const answer = terminal.question(secret ? '' : question, { signal: cancellation.signal });
      if (secret) {
        process.stdout.write(question);
      }
      const value = await answer;
      return value === '' ? fallback : value;
    } finally {
      if (secret) {
        hidden = false;
        process.stdout.write('\n');
      }
    }
  }

  const defaults = parseEnv(template);
  try {
    const values = {
      DB_HOST: await ask('PostgreSQL host', defaults.DB_HOST),
      DB_PORT: await ask('PostgreSQL port', defaults.DB_PORT),
      DB_DATABASE: await ask('PostgreSQL database'),
      DB_USER: await ask('PostgreSQL username'),
      DB_PASSWORD: await ask('PostgreSQL password', '', 'hidden'),
    };
    if (!isDatabasePort(values.DB_PORT)) {
      throw new Error('PostgreSQL port must be between 1 and 65535.');
    }
    let contents = template;
    for (const [key, value] of Object.entries(values)) {
      if (value === '') {
        throw new Error(`${key} is required.`);
      }
      if (!isPortableEnvValue(value)) {
        throw new Error(
          `${key} contains characters that Node and Docker Compose parse differently in double-quoted dotenv values.`,
        );
      }
      contents = contents.replace(new RegExp(`^${key}=.*$`, 'mu'), () => `${key}="${value}"`);
    }
    return contents;
  } finally {
    terminal.close();
  }
}

function replaceEnvFile(destinationPath: string, existing: string, contents: string): boolean {
  const lock = `${destinationPath}.create-env`;
  mkdirSync(lock, { mode: privateDirectoryMode });
  try {
    if (readFileSync(destinationPath, 'utf8') !== existing) {
      return false;
    }
    const temporaryPath = path.join(lock, '.env');
    writeFileSync(temporaryPath, contents, { mode: privateFileMode });
    renameSync(temporaryPath, destinationPath);
    return true;
  } finally {
    rmSync(lock, { recursive: true });
  }
}

async function prepareEnvFile(example: string, mode: CreationMode): Promise<EnvFile | null> {
  const destination = path.join(path.dirname(example), '.env');
  const destinationPath = path.join(rootDirectory, destination);
  const interactiveDatabase =
    example === databaseExample && process.stdin.isTTY && process.stdout.isTTY;
  const exists = existsSync(destinationPath);
  if (exists && mode === 'preserve' && !interactiveDatabase) {
    consola.info(`Keeping ${destination}`);
    return null;
  }

  const template = readFileSync(path.join(rootDirectory, example), 'utf8').replace(
    /^APP_ENV=.*$/mu,
    'APP_ENV="local"',
  );
  const existing = exists ? readFileSync(destinationPath, 'utf8') : null;
  if (existing !== null && mode === 'preserve' && existing !== template) {
    consola.info(`Keeping ${destination}`);
    return null;
  }

  const contents = interactiveDatabase
    ? await promptDatabaseEnv(template)
    : template.replaceAll(/^(?:AUTH_SECRET|NUXT_APP_SECRET)=""$/gmu, (assignment) =>
        assignment.replace('""', `"${generateSecret()}"`),
      );

  return {
    destination,
    existing,
    contents,
  };
}

function writeEnvFile(file: EnvFile, mode: CreationMode): void {
  const { destination, existing, contents } = file;
  const destinationPath = path.join(rootDirectory, destination);
  if (existing !== null) {
    if (replaceEnvFile(destinationPath, existing, contents)) {
      const action = mode === 'recreate' ? 'Recreated' : 'Configured';
      consola.success(`${action} ${destination}`);
    } else {
      consola.info(`Keeping ${destination}`);
    }
    return;
  }

  try {
    writeFileSync(destinationPath, contents, {
      flag: 'wx',
      mode: privateFileMode,
    });
    consola.success(`Created ${destination}`);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
    consola.info(`Keeping ${destination}`);
  }
}

async function createEnvFiles(mode: CreationMode): Promise<void> {
  const examples = globSync(['.env.example', '{apps,packages,scripts,tools}/*/.env.example'], {
    cwd: rootDirectory,
  }).toSorted();

  const files = await Promise.all(examples.map(async (example) => prepareEnvFile(example, mode)));
  for (const file of files) {
    if (file !== null) {
      writeEnvFile(file, mode);
    }
  }
}

try {
  const { values } = parseArgs({ options: { force: { type: 'boolean' } } });
  await createEnvFiles(values.force ? 'recreate' : 'preserve');
} catch (error) {
  consola.error(
    error instanceof Error ? error.message : 'Could not create local environment files.',
  );
  process.exitCode = 1;
}
