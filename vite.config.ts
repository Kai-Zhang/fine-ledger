import { defineConfig } from "vite";
export default defineConfig({
  publicDir: false,
  define: { __APP_BUILD__: JSON.stringify("development") },
  build: {
    outDir: ".local/frontend-build",
    emptyOutDir: true,
    assetsDir: "",
    chunkSizeWarningLimit: 800,
  },
});
