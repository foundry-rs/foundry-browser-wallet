import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [mkcert(), react()],
  build: {
    outDir: "dist",
    assetsDir: ".",
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
