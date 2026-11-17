import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { getWorkspaces } from '../utils/workspaces.ts';

let rootDirectory = '';

function writePackage(directory: string, name: string, scripts: Record<string, string>): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, scripts }));
}

beforeEach(() => {
  rootDirectory = mkdtempSync(path.join(tmpdir(), 'iam-workspaces-'));
  writePackage(rootDirectory, 'fixture-root', {
    build: 'node --version',
    typecheck: 'node --version',
  });
  writeFileSync(
    path.join(rootDirectory, 'pnpm-workspace.yaml'),
    "packages:\n  - projects/*\n  - modules/*\n  - '!projects/excluded'\n",
  );
});

afterEach(() => {
  rmSync(rootDirectory, {
    recursive: true,
    force: true,
  });
});

test('discovers scoped packages from workspace configuration and skips missing tasks and the root', () => {
  writePackage(path.join(rootDirectory, 'projects/app'), '@fixture/app', {
    build: 'node --version',
  });
  writePackage(path.join(rootDirectory, 'modules/library'), '@fixture/library', {
    typecheck: 'node --version',
  });
  writePackage(path.join(rootDirectory, 'projects/excluded'), 'excluded', {
    build: 'node --version',
  });
  writePackage(path.join(rootDirectory, 'elsewhere/unregistered'), 'unregistered', {
    build: 'node --version',
  });

  expect(getWorkspaces(rootDirectory, 'build')).toEqual(['projects/app']);
  expect(getWorkspaces(rootDirectory, 'typecheck')).toEqual(['modules/library']);
});

test('detects a newly added workspace without changes to the scripts', () => {
  expect(getWorkspaces(rootDirectory, 'build')).toEqual([]);
  writePackage(path.join(rootDirectory, 'modules/new'), '@fixture/new', {
    build: 'node --version',
  });

  expect(getWorkspaces(rootDirectory, 'build')).toEqual(['modules/new']);
});
