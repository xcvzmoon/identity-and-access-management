import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vite-plus/test';
import { hashReleaseBundle } from './release-inputs.ts';

test('binds the release digest to bundle contents, paths and link targets', ({
  onTestFinished,
}) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'iam-release-inputs-'));
  onTestFinished(() => {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  });
  const bundle = path.join(root, 'bundle');
  const file = path.join(bundle, 'original');
  const copy = path.join(bundle, 'copy');
  const link = path.join(bundle, 'current');

  mkdirSync(bundle);
  writeFileSync(file, 'initial');
  writeFileSync(copy, 'initial');
  symlinkSync('original', link);

  const initial = hashReleaseBundle(bundle);
  writeFileSync(file, 'updated');
  expect(hashReleaseBundle(bundle)).not.toBe(initial);
  writeFileSync(file, 'initial');
  expect(hashReleaseBundle(bundle)).toBe(initial);
  renameSync(copy, path.join(bundle, 'renamed'));
  expect(hashReleaseBundle(bundle)).not.toBe(initial);
  renameSync(path.join(bundle, 'renamed'), copy);
  unlinkSync(link);
  symlinkSync('copy', link);
  expect(hashReleaseBundle(bundle)).not.toBe(initial);

  writeFileSync(path.join(root, 'external'), 'outside bundle');
  unlinkSync(link);
  symlinkSync('../external', link);
  expect(() => hashReleaseBundle(bundle)).toThrow('must resolve inside the build');
});
