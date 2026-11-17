<!-- VITE PLUS START -->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!-- VITE PLUS END -->

<!-- NITRO START -->

# Using Nitro for API Server

This is a [Nitro](https://nitro.build) v3 server project (built on H3 v2). Nitro v3 differs a lot from v2 and your knowledge is likely outdated: read https://nitro.build/llms.txt (index of Markdown docs), especially `docs/utils.md` (imports) and `docs/migration.md` (v2 differences).

- `server/` is the server directory (`serverDir`); create subdirectories as needed: `api/` (routes under `/api`), `routes/`, `middleware/`, `plugins/` and `assets/` (server assets). File paths map to URLs: `server/api/users/[id].get.ts` is `GET /api/users/:id`.
- `public/` (project root) holds static files.
- No auto-imports: import `defineHandler`, `HTTPError`, ... from `"nitro"`, H3 utilities (`getQuery`, `readBody`, ...) from `"nitro/h3"`, and your own helpers (e.g. `server/utils/`) with relative imports.
- Handlers receive an H3 v2 event (`event.req` is a web `Request`, `event.url` a `URL`) and return JSON, a string or a `Response`.
- Scripts: `dev`, `build` (bundles into `.output/`; run with `node .output/server/index.mjs`), `preview`.
- Testing: `npx nitro fetch /api/hello` sends one request to the server sources (or to the running dev server) and prints the response, no build needed (curl-like options: `-X`, `-H`, `--json`, `-i`). `npx nitro serve` starts the server from the sources.

<!-- NITRO END -->

# Project conventions

## Guiding principle

- Prioritize readability and maintainability over ease of writing. Code is read and maintained long after it is written.
  Extra effort during implementation is worthwhile when it makes the code easier to understand and change.

## Changes and dependencies

- Always quote values in dotenv files, including `.env.example`, using double quotes.
- Keep changes limited to the requested behavior. Leave unrelated code, names, formatting, and existing classes alone.
- Use the simplest implementation that meets the requirements. Avoid speculative abstractions and temporary compatibility layers.
- Remove obsolete code paths. Add database migrations when required to preserve or transform existing data.
- Check existing dependencies' documentation and types before adding a package or implementing common functionality yourself.

## TypeScript and naming

- Prefer `type` over `interface`, functions over classes, and string literal unions for small enums. TaggedError subclasses are expected.
- Use named function declarations for helpers and arrows for callbacks.
- Always use braces for branches and loops.
- Add explicit return types to exported functions and non-trivial helpers.
- Use plural SQL table names and declaration identifiers, including fixtures.
- Do not abbreviate iterable item names. Reserve one-letter names for conventional indexes.
- Do not use `any`. Validate or narrow `unknown` values.
- Avoid type assertions and non-null assertions. When unavoidable, justify the invariant with a `SAFETY:` comment.
- Use `@ts-expect-error` with a reason instead of `@ts-ignore`.
- Handle discriminated unions exhaustively.
- Use branded types when distinct identifiers could otherwise be mixed up.
- Avoid unclear boolean parameters; use named options or literal unions.
- Prefer readonly collection inputs when mutation is unnecessary.
- Do not monkey-patch dependencies or augment types you do not own.

## Lint rules and directives

- Rules from the `eslint`, `typescript`, and `unicorn` plugins are experimental. When necessary while generating code, disable the specific rule for the smallest affected scope.
- After disabling an experimental rule, report its full `plugin/rule` name, affected locations, and reason in the final response and PR description when applicable, so I can decide whether to keep or remove it.
- For every lint enable or disable directive, regardless of plugin, put a reason comment immediately above it and name the specific `plugin/rule`. Use this format, choosing one directive:

```ts
// reason for disabling or enabling the lint rule
// {{ oxlint-enable || oxlint-disable || oxlint-disable-line || oxlint-disable-next-line }} {{ plugin }}/{{ rule }}
```

## Documentation and comments

- Document public package exports with JSDoc. Document internal functions when callers need details about behavior, constraints, or ownership.
- Where needed, explain parameters, defaults, return values, thrown errors, and resource cleanup. Distinguish returned Err values from thrown errors.
- Use accurate TypeScript examples without repeating signature types.
- Do not add ordinary comments except the required reasons above lint directives. Preserve lint directives, `SAFETY:` comments, and accurate JSDoc.
- Apply the unslop skill when writing documentation or JSDoc.

## Git and pull requests

- For PRs, use the repository template, antfu-create-pr, and unslop. Assign the PR to me, apply appropriate labels, and omit model attribution.
- Begin PR descriptions with two or three complete sentences explaining the problem, resulting behavior, and why the change is needed.

## Skills

- Project skills live in `.agents/skills/` and are tracked in `skills-lock.json`. Use applicable skills.
- Use [commit](.agents/skills/commit/SKILL.md) for commits.
- Treat vendored skills as tooling. Do not modify them as part of product work.

## Persistent knowledge

- Keep repository rules in AGENTS.md, workflow procedures in skills, and durable explanations, decisions, and gotchas in brain/. Follow AGENTS.md when a brain note conflicts with repository rules.
- Use brain/index.md to find notes relevant to the current task. Read only the relevant notes; do not load the entire vault.
- When remembering a new rule, update its authoritative instructions. Keep a brain note only when it adds useful rationale or examples, and link to those instructions instead of repeating them. Remove notes subsumed by existing instructions.
