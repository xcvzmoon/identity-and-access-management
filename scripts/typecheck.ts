import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getWorkspaces } from './utils/workspaces.ts';

const rootDirectory = path.resolve(import.meta.dirname, '..');

function typecheck(): void {
  consola.info('Typechecking root');
  execFileSync('vpx', ['tsc'], {
    cwd: rootDirectory,
    stdio: 'pipe',
  });
  const workspaces = getWorkspaces(rootDirectory, 'typecheck');
  for (const workspace of workspaces) {
    consola.info(`Typechecking ${workspace}`);
    execFileSync('vp', ['-C', workspace, 'run', 'typecheck'], {
      cwd: rootDirectory,
      stdio: 'pipe',
    });
  }
  consola.success('Typecheck complete');
}

try {
  typecheck();
} catch (error) {
  consola.error('Typecheck failed', error);
  process.exitCode = 1;
}
