# Anti-slop provenance

Source repository: https://github.com/dmmulroy/anti-slop

Installed from the local skill snapshot at
`.agents/skills/install-anti-slop/assets/anti-slop/`, using its bundled
`scripts/install.mjs`. The skill lock identifies `skills/install-anti-slop/SKILL.md`
and computed hash `1b9b5d3c0d9e0ef8dd7631f4d637e66b62a73e34dceaf4ae07c0d3de376fd7d7`.
This is a skill snapshot identifier, not an upstream Git revision.
The exact upstream commit is unknown; no revision was provided with the assets.

Installed paths:

- Generic entry point: `tools/oxlint/anti-slop/index.ts`
- Rules, shared helpers, and vendored Stylistic files beneath the same directory.

The original installation was verified against the bundled skill assets.
The repository now retains only the generic plugin; the optional framework-specific
rule bundle was removed from both this installation and the installer assets.
The installer instructions were narrowed to the retained generic plugin. The upstream identifiers in `skills-lock.json` identify the downloaded
snapshots; tracked local changes record these customizations.

`SOURCE-SHA256SUMS` records SHA-256 hashes of retained files, relative to this
directory. The nested provenance text now describes generator coverage without
naming a removed integration; its checksum was updated. Rule implementations
and licenses are unchanged. The retained files match the local installer assets.

Oxlint registers the generic plugin and generic rules at error severity,
plus `oxc/no-accumulating-spread`. Both lint and format configuration exclude
the vendored plugin and agent tooling directories.

The nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` are preserved.
That nested provenance describes the Stylistic origin and upstream adaptations;
it does not identify the source revision of the overall anti-slop snapshot.
