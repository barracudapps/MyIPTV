import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Chaque build n'embarque que son backend : pas de WASM dans l'app native, pas d'API Tauri sur TV.
    __WEB_BACKEND__: JSON.stringify(mode !== "production"),
    __NATIVE_BACKEND__: JSON.stringify(mode !== "web"),
  },
  clearScreen: false,
  // Les smart TV chargent l'app depuis le système de fichiers : chemins relatifs.
  base: "./",
  // Version web/TV : navigateurs intégrés anciens (Tizen 5 = Chromium 63, webOS 5 = Chromium 68).
  build: { target: mode === "web" ? ["es2017", "chrome63", "safari12"] : ["es2020", "safari14"], chunkSizeWarningLimit: 1500 },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
