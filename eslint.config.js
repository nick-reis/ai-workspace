import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/gen/**",
      "src-tauri/target/**",
      "src/types/database.generated.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactHooks.configs.flat["recommended-latest"].rules,
  },
  {
    files: ["src/**/*.tsx"],
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactRefresh.configs.vite.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      globals: globals.deno,
    },
  },
);
