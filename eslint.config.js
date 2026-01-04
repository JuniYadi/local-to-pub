import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Disable all formatting rules (Prettier handles this)
  {
    ignores: [
      "**/node_modules/",
      "**/bun.lockb",
      "**/*.lock",
      "**/dist/",
      "**/build/",
      "**/.git/",
      "**/frontend.js",
      "**/frontend.css",
      "**/styles.css"
    ]
  },
  // JavaScript recommended rules
  js.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommended,
  // Project-specific rules
  {
    rules: {
      // TypeScript rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      // Import rules
      "no-unused-vars": "off", // Handled by TypeScript
      "no-empty": ["error", { "allowEmptyCatch": true }],
    }
  }
);
