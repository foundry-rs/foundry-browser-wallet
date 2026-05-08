import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: ".",
    sourcemap: true,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: "index.html",
      output: {
        codeSplitting: false,
        manualChunks: undefined,
        entryFileNames: "main.js",
        chunkFileNames: "main.js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "styles.css" : "[name][extname]",
      },
    },
  },
});
