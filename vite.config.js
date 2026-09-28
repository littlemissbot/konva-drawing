import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        canvas: resolve(__dirname, "src/canvas.html"),
      },
      output: {
        manualChunks: {
          vendor: ["konva", "bootstrap"],
        },
      },
    },
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    sourcemap: false,
  },
  resolve: {
    // None of these are actually used by any import in the codebase yet
    // (all current imports are relative); kept up to date with the
    // src/js layout (see docs/TASKS.md P0-9) for whenever that changes.
    // The previous version of this list still pointed at
    // src/js/components and src/js/utils, both dissolved by that same
    // restructure, and at src/js/services, which never existed.
    alias: {
      "@": resolve(__dirname, "./src"),
      "@core": resolve(__dirname, "./src/js/core"),
      "@canvas": resolve(__dirname, "./src/js/canvas"),
      "@ui": resolve(__dirname, "./src/js/ui"),
      "@assets": resolve(__dirname, "./src/assets"),
    },
  },
  css: {
    devSourcemap: true,
  },
  server: {
    port: process.env.VITE_PORT || 5173,
    host: process.env.VITE_HOST || "0.0.0.0",
    open: false,
  },
});
