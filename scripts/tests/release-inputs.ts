import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

type ReleaseInputs = {
  revision: string;
  dirty: boolean;
  bundleSha256: Record<string, string>;
};

const EMPTY = 0;
const workspaces = ['idp/api', 'idp/web', 'console/api', 'console/web'];

/**
 * Fingerprints build-relative paths, file contents and link targets. Links must resolve within the bundle.
 * @param {string} directory - Built Nitro output directory.
 * @returns {string} SHA-256 digest of the sorted directory traversal.
 */
export function hashReleaseBundle(directory: string): string {
  const root = realpathSync(directory);
  const hash = createHash('sha256');

  function visit(relative: string): void {
    const filename = path.join(root, relative);
    const entry = lstatSync(filename);
    if (entry.isDirectory()) {
      hash.update(JSON.stringify(['directory', relative]));
      for (const name of readdirSync(filename).toSorted()) {
        visit(path.posix.join(relative, name));
      }
      return;
    }

    if (entry.isSymbolicLink()) {
      const target = readlinkSync(filename);
      const resolved = realpathSync(filename);
      if (path.isAbsolute(target) || !resolved.startsWith(root + path.sep)) {
        throw new Error(`Release bundle link must resolve inside the build: ${relative}`);
      }
      hash.update(JSON.stringify(['link', relative, target]));
      return;
    }

    if (!entry.isFile()) {
      throw new Error(`Unsupported release bundle entry: ${relative}`);
    }

    const digest = createHash('sha256').update(readFileSync(filename)).digest('hex');
    hash.update(JSON.stringify(['file', relative, digest]));
  }

  visit('');
  return hash.digest('hex');
}

/**
 * Captures the checkout and built workspaces that the local release fixtures use.
 * @param {string} root - Repository root.
 * @returns {object} Git revision, dirty flag and per-workspace build digests.
 */
export function captureReleaseInputs(root: string): ReleaseInputs {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: root,
  });
  const dirty = status.length > EMPTY;
  const bundleSha256: Record<string, string> = {};
  for (const workspace of workspaces) {
    const directory = path.join(root, 'apps', workspace, '.output');
    if (!statSync(path.join(directory, 'server/index.mjs')).isFile()) {
      throw new Error(`Missing release entry point for ${workspace}`);
    }
    bundleSha256[workspace] = hashReleaseBundle(directory);
  }

  return { revision, dirty, bundleSha256 };
}
