import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getWorkspaces } from './utils/ts.workspaces.ts';

const rootDirectory = path.resolve(import.meta.dirname, '..');

try {
  const workspaces = getWorkspaces(rootDirectory, 'build');

  for (const workspace of workspaces) {
    execFileSync('vp', ['-C', workspace, 'run', 'build'], {
      cwd: rootDirectory,
      stdio: 'inherit',
    });
  }

  consola.success('Build complete');
} catch (error) {
  consola.error('Build failed', error);
  process.exitCode = 1;
}
