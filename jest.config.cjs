// CommonJS (not .js) because package.json sets "type": "module".
module.exports = {
  testEnvironment: "jsdom",
  setupFiles: ["<rootDir>/jest.setup.cjs"],
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.js"],
  // Playwright e2e specs live under e2e/ and run via `npm run test:e2e`,
  // not Jest - keep the two runners' file sets disjoint.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/e2e/"],
  // konva's package.json "main" points at lib/index-node.js, which
  // requires the native `canvas` package for real server-side rendering.
  // This project doesn't use that (and doesn't want a native build
  // dependency just for tests); the shipped app is bundled by Vite
  // against konva's "browser" field (lib/index.js) instead, so tests
  // are pointed at that same file for consistency with production and
  // to avoid the native dependency. Submodule imports like
  // "konva/lib/shapes/Circle" are unaffected - only the bare "konva"
  // specifier is ambiguous.
  moduleNameMapper: {
    "^konva$": "<rootDir>/node_modules/konva/lib/index.js",
  },
};
