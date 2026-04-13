import react from "@vitejs/plugin-react-swc";
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
        inlineDynamicImports: true,
        manualChunks: undefined,
        entryFileNames: "main.js",
        chunkFileNames: "main.js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css") ? "styles.css" : "[name][extname]",
      },
    },
  },
});
