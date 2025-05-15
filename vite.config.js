import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  base: "/",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["konva", "bootstrap", "jquery"],
        },
      },
    },
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    sourcemap: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@components": resolve(__dirname, "./src/js/components"),
      "@utils": resolve(__dirname, "./src/js/utils"),
      "@services": resolve(__dirname, "./src/js/services"),
      "@assets": resolve(__dirname, "./src/assets"),
    },
  },
  css: {
    devSourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});
