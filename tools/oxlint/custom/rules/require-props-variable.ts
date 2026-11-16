import { defineRule } from "vite-plus/lint/plugins";

export const requirePropsVariableRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require assigning defineProps to a const variable named props.",
    },
    messages: {
      propsVariable:
        "Assign props with const props = defineProps<Props>() or const props = withDefaults(defineProps<Props>(), defaults).",
    },
  },
  createOnce: (context) => {
    return {
      CallExpression: (node) => {
        if (node.callee.type !== "Identifier" || node.callee.name !== "defineProps") {
          return;
        }

        let propsExpression = node;
        const parent = node.parent;

        if (
          parent.type === "CallExpression" &&
          parent.callee.type === "Identifier" &&
          parent.callee.name === "withDefaults" &&
          parent.arguments[0] === node
        ) {
          propsExpression = parent;
        }

        const declaration = propsExpression.parent;

        if (
          declaration.type === "VariableDeclarator" &&
          declaration.init === propsExpression &&
          declaration.id.type === "Identifier" &&
          declaration.id.name === "props" &&
          declaration.parent.type === "VariableDeclaration" &&
          declaration.parent.kind === "const"
        ) {
          return;
        }

        context.report({ node: propsExpression, messageId: "propsVariable" });
      },
    };
  },
});
