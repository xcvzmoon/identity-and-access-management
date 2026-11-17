import type { SpawnSyncOptionsWithBufferEncoding, SpawnSyncReturns } from 'node:child_process';
import { consola } from 'consola';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

type ContainerCli = 'docker' | 'kiri';

const rootDirectory = path.resolve(import.meta.dirname, '..');
const dockerDesktopContext = 'desktop-linux';
const successExitCode = 0;
const failureExitCode = 1;
const expectedCommandCount = 1;
const commands = new Map([
  ['build', ['build']],
  ['up', ['up', '--build', '--detach']],
  ['down', ['down']],
  ['start', ['start']],
  ['stop', ['stop']],
  ['restart', ['restart']],
  ['logs', ['logs']],
  ['ps', ['ps', '--all']],
]);

const help = `Usage: vp run docker [--container <docker|kiri>] [--app <api|web|all>] <command>

Commands:
  build       Build images
  up          Build and start containers in the background
  down        Stop and remove containers
  start       Start existing containers
  stop        Stop containers
  restart     Restart containers
  logs        Show container logs (use --follow or -f to stream)
  ps          Show container status

Omit --app to target both apps.
Docker is the default. If both are installed, an interactive terminal offers Kiri.
Docker targets Docker Desktop when its context is configured.
Use --container to select Docker or Kiri directly.
Use --help or -h to show this message.`;

function isMissingExecutable(error: Error | undefined): boolean {
  return Boolean(error && 'code' in error && error.code === 'ENOENT');
}

function spawnContainerCli(
  cli: ContainerCli,
  args: readonly string[],
  options: SpawnSyncOptionsWithBufferEncoding,
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(cli, args, options);
  if (cli !== 'kiri' || process.platform !== 'darwin' || !isMissingExecutable(result.error)) {
    return result;
  }

  for (const executable of [
    path.join(homedir(), '.kiri', 'bin', 'kiri'),
    '/Applications/Kiri.app/Contents/MacOS/kiri',
  ]) {
    const fallback = spawnSync(executable, args, options);
    if (!isMissingExecutable(fallback.error)) {
      return fallback;
    }
  }

  return result;
}

function hasCompose(cli: ContainerCli): boolean {
  const result = spawnContainerCli(cli, ['compose', 'version'], {
    cwd: rootDirectory,
    stdio: 'ignore',
  });
  return result.status === successExitCode;
}

function getDockerContextArgs(): string[] {
  const desktop = spawnSync('docker', ['context', 'inspect', dockerDesktopContext], {
    cwd: rootDirectory,
    stdio: 'ignore',
  });
  if (desktop.status === successExitCode) {
    return ['--context', dockerDesktopContext];
  }

  const current = spawnSync('docker', ['context', 'show'], {
    cwd: rootDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (current.status === successExitCode && current.stdout.trim() === 'kiri') {
    return ['--context', 'default'];
  }

  return [];
}

async function selectContainerCli(requested: string | null): Promise<ContainerCli> {
  if (requested !== null) {
    if (requested === 'docker' || requested === 'kiri') {
      return requested;
    }
    throw new Error('Expected --container to be docker or kiri.');
  }

  const hasKiri = hasCompose('kiri');
  if (!hasCompose('docker')) {
    if (hasKiri) {
      return 'kiri';
    }
    throw new Error('Install Docker Compose or Kiri to run this command.');
  }

  if (hasKiri && process.stdin.isTTY && process.stdout.isTTY) {
    const useKiri = await consola.prompt('Use Kiri instead of Docker?', {
      type: 'confirm',
      initial: false,
      cancel: 'reject',
    });
    if (useKiri) {
      return 'kiri';
    }
  }

  return 'docker';
}

function executeCompose(cli: ContainerCli, args: readonly string[]): number {
  const contextArgs = cli === 'docker' ? getDockerContextArgs() : [];
  const env =
    cli === 'docker'
      ? {
          ...process.env,
          BUILDX_BUILDER: 'default',
        }
      : process.env;
  const result = spawnContainerCli(cli, [...contextArgs, 'compose', ...args], {
    cwd: rootDirectory,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    if (isMissingExecutable(result.error)) {
      throw new Error(`Could not find ${cli}. Install it or add it to your PATH.`, {
        cause: result.error,
      });
    }
    throw result.error;
  }
  return result.status ?? failureExitCode;
}

async function runCompose(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: {
      app: {
        type: 'string',
        default: 'all',
      },
      container: { type: 'string' },
      follow: {
        type: 'boolean',
        short: 'f',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
    },
    allowPositionals: true,
  });

  if (values.help) {
    process.stdout.write(`${help}\n`);
    return successExitCode;
  }

  const [command] = positionals;
  const composeArgs = command && commands.get(command);
  if (positionals.length !== expectedCommandCount || !composeArgs) {
    throw new Error('Choose one Docker command.');
  }

  const { app, container, follow } = values;
  if (app !== 'all' && app !== 'api' && app !== 'web') {
    throw new Error('Expected --app to be api, web, or all.');
  }
  if (follow && command !== 'logs') {
    throw new Error('--follow is only available for logs.');
  }

  const cli = await selectContainerCli(container ?? null);
  const serviceArgs = app === 'all' ? [] : [app];
  const operationArgs =
    command === 'down' && app !== 'all' ? ['rm', '--stop', '--force'] : composeArgs;

  return executeCompose(cli, [...operationArgs, ...(follow ? ['--follow'] : []), ...serviceArgs]);
}

try {
  process.exitCode = await runCompose();
} catch (error) {
  consola.error(error instanceof Error ? error.message : error);
  process.stderr.write('Run vp run docker --help for usage.\n');
  process.exitCode = failureExitCode;
}
