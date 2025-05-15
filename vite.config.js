import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
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
});
