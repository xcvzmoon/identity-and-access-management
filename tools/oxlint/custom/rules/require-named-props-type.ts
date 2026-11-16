import { defineRule } from "vite-plus/lint/plugins";

export const requireNamedPropsTypeRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Require a named type reference in defineProps calls.",
    },
    messages: {
      namedType: "Declare a named props type and use defineProps<Props>().",
    },
  },
  createOnce: (context) => {
    return {
      CallExpression: (node) => {
        if (node.callee.type !== "Identifier" || node.callee.name !== "defineProps") {
          return;
        }

        const propsType = node.typeArguments?.params[0];
        if (propsType?.type !== "TSTypeReference") {
          context.report({ node: propsType ?? node, messageId: "namedType" });
        }
      },
    };
  },
});
