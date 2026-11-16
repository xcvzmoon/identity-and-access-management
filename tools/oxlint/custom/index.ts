import { eslintCompatPlugin } from "vite-plus/lint/plugins";

import { noInlineBlocksRule } from "./rules/no-inline-blocks.ts";
import { requireMultilineObjectPropertiesRule } from "./rules/require-multiline-object-properties.ts";
import { requireNamedPropsTypeRule } from "./rules/require-named-props-type.ts";
import { requirePropsVariableRule } from "./rules/require-props-variable.ts";
import { typeImportsFirstRule } from "./rules/type-imports-first.ts";

const customPlugin = eslintCompatPlugin({
  meta: {
    name: "custom",
  },
  rules: {
    "no-inline-blocks": noInlineBlocksRule,
    "require-multiline-object-properties": requireMultilineObjectPropertiesRule,
    "require-named-props-type": requireNamedPropsTypeRule,
    "require-props-variable": requirePropsVariableRule,
    "type-imports-first": typeImportsFirstRule,
  },
});

export default customPlugin;
