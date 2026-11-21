---
name: new-line-spacing
description: Review or edit blank-line spacing in TypeScript and JavaScript using xcvzmoon's preferences for readable statement groups. Use for newline or whitespace feedback, spacing reviews, and the final readability pass on touched code when AGENTS.md directs it.
---

# New Line Spacing

Help a developer read a function in meaningful groups. Use blank lines to show where the reader should pause. A blank line can also interrupt a small step that makes sense as a unit.

1. Read the whole function and nearby code in the same layer. Identify what each group does, such as resolving request context, validating the request, persisting data, or shaping a response.
2. Compare the two plausible layouts at each awkward boundary. Ask whether the next statement completes the current step, or whether the reader needs a pause before it. Weigh the complexity and size of the surrounding group, not just whether it fits on one line.
3. Compare the **Good here** and **Bad here** layouts for the closest example by purpose and context. Read [Confirmed spacing patterns](references/confirmed.md) for fictional examples of the owner's preferences. Use [Statement examples](references/statements.md) for function bodies and [Structural examples](references/structure.md) for files, data definitions, and tests.
4. Format the edited files and reread the full blocks. For a spacing-only request, compare the nonblank lines against the original to catch accidental code or comment edits. Keep the scope the user asked for.

Do not translate these examples into a global lint rule, a regex edit, or a rule based on line count. A short parse plus its error check, a setup group plus a guard, and a long one-line expression can need different spacing. Preserve an explicit correction at the location it addresses. Look for the reason behind it before applying it anywhere else.

If the request identifies a specific awkward block, show or fix the smallest relevant grouping. If the user asks for a broader review, read every changed function in scope and verify actual edits. Report what was examined without implying unchanged blocks were rewritten.
