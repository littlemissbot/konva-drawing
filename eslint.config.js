import js from "@eslint/js";
import globals from "globals";
import jestPlugin from "eslint-plugin-jest";
import playwrightPlugin from "eslint-plugin-playwright";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "test-results/",
      "playwright-report/",
      "public/",
    ],
  },

  js.configs.recommended,

  // Browser app code.
  {
    files: ["src/js/**/*.js"],
    ignores: ["src/js/**/__tests__/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },

  // Jest unit tests.
  {
    files: ["src/js/**/__tests__/**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.jest, ...globals.node },
    },
    plugins: { jest: jestPlugin },
    rules: { ...jestPlugin.configs.recommended.rules },
  },

  // Playwright e2e specs. These mix two contexts in one file: the outer
  // test code runs under Node (test/expect/page), while callbacks passed
  // to page.evaluate() run in the browser (window/document) - both
  // globals sets are included since ESLint parses the whole file the
  // same way regardless of where each part actually executes.
  {
    files: ["e2e/**/*.spec.js", "e2e/**/*.js"],
    ...playwrightPlugin.configs["flat/recommended"],
    languageOptions: {
      ...playwrightPlugin.configs["flat/recommended"].languageOptions,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...playwrightPlugin.configs["flat/recommended"].rules,
      // page.click()/fill()/focus() are still fully supported, current
      // Playwright APIs, not deprecated; the plugin's preference for the
      // newer locator-chained form (page.locator(x).click()) is a style
      // choice with no functional difference, and this codebase's ~20
      // call sites consistently use the plain form. Left as a deliberate
      // style choice rather than churning every call site to silence a
      // preference rule.
      "playwright/prefer-locator": "off",
    },
  },

  // Node-side config/tooling files.
  {
    files: [
      "*.config.js",
      "*.config.cjs",
      "*.setup.cjs",
      "babel.config.cjs",
      "jest.config.cjs",
      "jest.setup.cjs",
      "playwright.config.js",
      "vite.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    files: ["*.cjs", "**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },

  {
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Disables every ESLint stylistic rule that would conflict with
  // Prettier; must stay last so nothing after it re-enables one.
  prettierConfig,
];
