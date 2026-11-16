import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import { globSync, rmSync } from 'node:fs';
import path from 'node:path';

const rootDirectory = path.resolve(import.meta.dirname, '..');

function runStep(
  message: string,
  arguments_: readonly string[],
  stdio: 'pipe' | 'inherit' = 'pipe',
): void {
  consola.info(message);
  execFileSync('vp', arguments_, {
    cwd: rootDirectory,
    stdio,
  });
}

function refresh(): void {
  const dependencyDirectories = globSync('**/node_modules', {
    cwd: rootDirectory,
    exclude: ['**/node_modules/**', '.git/**'],
  });

  for (const directory of dependencyDirectories) {
    let workspace = path.dirname(directory);
    if (workspace === '.') {
      workspace = 'root';
    }

    consola.info(`Removing ${workspace} node_modules`);
    rmSync(path.resolve(rootDirectory, directory), {
      recursive: true,
      force: true,
    });
  }

  consola.info('Removing pnpm-lock.yaml');
  rmSync(path.resolve(rootDirectory, 'pnpm-lock.yaml'), { force: true });
  runStep('Installing dependencies', ['install', '--no-frozen-lockfile']);
  runStep('Cleaning Nuxt', ['run', '--no-cache', '--filter', 'web', 'cleanup']);
  runStep('Building workspaces', ['run', '--no-cache', 'build'], 'inherit');
  runStep('Checking code', ['run', '--no-cache', 'check']);
  runStep('Typechecking root and workspaces', ['run', '--no-cache', 'typecheck'], 'inherit');
  runStep('Running tests', ['run', '--no-cache', 'test']);
  consola.success('Refresh complete');
}

try {
  refresh();
} catch (error) {
  consola.error('Refresh failed', error);
  process.exitCode = 1;
}
