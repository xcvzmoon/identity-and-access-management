import { execFileSync } from 'node:child_process';

const workspacePlanVersion = 1;

type WorkspaceTask = {
  package: string;
  name: string;
};

type WorkspacePlan = {
  version: typeof workspacePlanVersion;
  plan: Record<string, WorkspaceTask>;
};

// The Vite+ JSON response needs structural validation before its task paths can be used.
// oxlint-disable anti-slop/no-runtime-typeof
function isWorkspaceTask(value: unknown): value is WorkspaceTask {
  return (
    typeof value === 'object' &&
    value !== null &&
    'package' in value &&
    typeof value.package === 'string' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function isWorkspacePlan(value: unknown): value is WorkspacePlan {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== workspacePlanVersion ||
    !('plan' in value) ||
    typeof value.plan !== 'object' ||
    value.plan === null ||
    Array.isArray(value.plan)
  ) {
    return false;
  }

  return Object.values(value.plan).every((task) => isWorkspaceTask(task));
}

// Structural checks are limited to the external JSON boundary above.
// oxlint-enable anti-slop/no-runtime-typeof

/**
 * Discovers workspace directories defining a task through a Vite+ dry run.
 * Excludes the root package and leaves task execution to the caller.
 *
 * @param {string} rootDirectory - Absolute repository root directory.
 * @param {'build' | 'typecheck'} task - Task to discover.
 * @returns {string[]} Unique workspace paths relative to the repository root.
 */
export function getWorkspaces(rootDirectory: string, task: 'build' | 'typecheck'): string[] {
  const output = execFileSync(
    'vp',
    ['run', '--dry-run', '--parallel', '--json', '--filter', '**', '--filter', '!./', task],
    {
      cwd: rootDirectory,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );
  const result: unknown = JSON.parse(output);
  if (!isWorkspacePlan(result)) {
    throw new TypeError('Invalid workspace task plan returned by Vite+');
  }

  const workspaces = Object.values(result.plan)
    .filter((entry) => entry.name === task && entry.package !== '.')
    .map(({ package: workspace }) => workspace);

  return [...new Set(workspaces)];
}
