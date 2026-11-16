import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getWorkspaces } from './utils/workspaces.ts';

const rootDirectory = path.resolve(import.meta.dirname, '..');

function build(): void {
  const workspaces = getWorkspaces(rootDirectory, 'build');
  for (const workspace of workspaces) {
    consola.info(`Building ${workspace}`);
    execFileSync('vp', ['-C', workspace, 'run', 'build'], {
      cwd: rootDirectory,
      stdio: 'pipe',
    });
  }
  consola.success('Build complete');
}

try {
  build();
} catch (error) {
  consola.error('Build failed', error);
  process.exitCode = 1;
}
