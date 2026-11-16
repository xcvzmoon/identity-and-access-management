# Project conventions

## Guiding principle

- Prioritize readability and maintainability over ease of writing. Code is read and maintained long after it is written.
  Extra effort during implementation is worthwhile when it makes the code easier to understand and change.

## Vite+

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

- `vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task, so `vp dev` and `vp run dev` can differ.
- Run TypeScript and JavaScript files with `vpx <file>`. Do not add `tsx` or `ts-node`.
- Run `vp install` after pulling changes. If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor`.

## Nitro

- Nitro v3 with H3 v2. Before changing Nitro APIs, consult https://nitro.build/llms.txt, especially the utilities and migration docs.
- `server/` is the server directory. API routes live in `server/api/`; root static assets live in `public/`.
- No auto-imports. Import handlers and plugins from `nitro`, H3 utilities from `nitro/h3`, and project helpers through relative imports.
- H3 events expose a web Request at `event.req` and URL at `event.url`.
- Use pnpm as the package manager, and run installs through `vp install`. Available scripts are defined in `package.json`.

## Configuration, validation, and errors

- Use `@xcvzlabs/env` with Valibot leaves for environment parsing. Use Valibot for request and form validation.
- Put reusable schemas and `createSecret` in `packages/utils/schema.ts`. Name schemas in camelCase, such as `nonEmptyStringSchema`.
- Validate external input at the boundary. Prefer built-in schema actions and reusable transforms over manual parsing.
- Use native Promises and better-result Results for asynchronous operations with expected failures.
  Define application errors with `TaggedError` and stable error codes.
- Never swallow errors or leave an empty `catch`. Always await or handle promises.
- Keep credentials redacted with `createSecret`. Unwrap them only at driver boundaries, and exclude secrets from errors and logs.
- Use Drizzle's node-postgres driver. Initialize shared resources from Nitro plugins and close owned pools during shutdown.
- Do not perform resource initialization or network calls at import time.

## Changes and dependencies

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
- Narrow with `if`, `in`, type guards, and early returns instead of checking and then asserting.
- Avoid type assertions and non-null assertions. When unavoidable, justify the invariant with a `SAFETY:` comment.
- Use `@ts-expect-error` with a reason instead of `@ts-ignore`.
- Handle discriminated unions exhaustively.
- Use branded types when distinct identifiers could otherwise be mixed up.
- Avoid unclear boolean parameters; use named options or literal unions.
- Prefer readonly collection inputs when mutation is unnecessary.
- Do not monkey-patch dependencies or augment types you do not own.

## Documentation and comments

- Document public package exports with JSDoc. Document internal functions when callers need details about behavior, constraints, or ownership.
- Where needed, explain parameters, defaults, return values, thrown errors, and resource cleanup. Distinguish returned Err values from thrown errors.
- Use accurate TypeScript examples without repeating signature types.
- Do not add ordinary comments. Preserve lint directives, `SAFETY:` comments, and accurate JSDoc.
- Apply the unslop skill when writing documentation or JSDoc.

## Verification

- Let Vite Plus define formatting and lint conventions.
- Run checks appropriate to the change: `vp run check`, `vp run typecheck`, `vp run test`, and `vp run build`.

## Git and pull requests

- Use the current worktree unless explicitly asked to create another.
- Commit or push only when asked. Never add co-author trailers.
- Give each commit one independently reviewable purpose. Keep required imports, types, call sites, and tests together so intermediate commits remain valid.
  Separate independent changes, even within one file.
- Stage explicit paths or hunks and review the staged diff before committing.
- For PRs, use the repository template, antfu-create-pr, and unslop. Assign the PR to me, apply appropriate labels, and omit model attribution.
- Begin PR descriptions with two or three complete sentences explaining the problem, resulting behavior, and why the change is needed.

## Skills

- Project skills live in `.agents/skills/` and are tracked in `skills-lock.json`. Use applicable skills.
- Treat vendored skills as tooling. Do not modify them as part of product work.

## Persistent knowledge

- Keep repository rules in AGENTS.md, workflow procedures in skills, and durable explanations, decisions, and gotchas in brain/. Follow AGENTS.md when a brain note conflicts with repository rules.
- Use brain/index.md to find notes relevant to the current task. Read only the relevant notes; do not load the entire vault.
- When remembering a new rule, update its authoritative instructions. Keep a brain note only when it adds useful rationale or examples, and link to those instructions instead of repeating them. Remove notes subsumed by existing instructions.
