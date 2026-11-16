import { defineRule } from "vite-plus/lint/plugins";

export const requireMultilineObjectPropertiesRule = defineRule({
  meta: {
    type: "layout",
    docs: {
      description:
        "Require multiline object literals unless they have at most one property or contain only shorthand properties and spreads.",
    },
    messages: {
      multiline:
        "Put object properties on separate lines between the braces. Objects with at most one property or only shorthand properties and spreads may stay inline.",
    },
  },
  createOnce: (context) => {
    return {
      ObjectExpression: (node) => {
        if (
          node.properties.length <= 1 ||
          node.properties.every(
            (property) =>
              property.type === "SpreadElement" ||
              (property.type === "Property" && property.shorthand),
          )
        ) {
          return;
        }

        let previousLine = node.loc.start.line;

        for (const property of node.properties) {
          if (property.loc.start.line <= previousLine) {
            context.report({ node, messageId: "multiline" });
            return;
          }

          previousLine = property.loc.end.line;
        }

        if (node.loc.end.line <= previousLine) {
          context.report({ node, messageId: "multiline" });
        }
      },
    };
  },
});
