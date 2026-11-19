import { consola } from 'consola';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getWorkspaces } from './utils/workspaces.ts';

const rootDirectory = path.resolve(import.meta.dirname, '..');

try {
  const workspaces = getWorkspaces(rootDirectory, 'build');
  const database = 'packages/database';
  const shared = 'packages/shared';
  const orderedWorkspaces = [
    database,
    shared,
    ...workspaces.filter(
      (workspace) =>
        workspace.startsWith('packages/') && workspace !== database && workspace !== shared,
    ),
    ...workspaces.filter((workspace) => !workspace.startsWith('packages/')),
  ];

  execFileSync('vp', ['-C', shared, 'run', 'build:utils'], {
    cwd: rootDirectory,
    stdio: 'inherit',
  });

  for (const workspace of orderedWorkspaces) {
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
