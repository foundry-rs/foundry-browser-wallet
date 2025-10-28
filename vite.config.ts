import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

export default defineConfig({
  plugins: [
    mkcert(),
    react(),
    {
      name: "add-session-token-banner",
      generateBundle(_, bundle) {
        for (const file of Object.values(bundle)) {
          if (file.type === "chunk" && file.fileName === "main.js") {
            file.code = `/** SESSION_TOKEN */\n\n${file.code}`;
          }
        }
      },
    },
  ],
  server: {
    port: 9545,
  },
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
