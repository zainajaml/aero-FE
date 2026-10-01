import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "src/database/migrations"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: "Read configuration through src/config/env.ts only.",
        },
      ],
    },
  },
  {
    files: [
      "src/config/env.ts",
      "drizzle.config.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "vitest.config.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
);
