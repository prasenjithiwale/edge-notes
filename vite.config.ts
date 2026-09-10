import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri drives the dev server, so the port is fixed and failures must be loud.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // WebKit on macOS 12 and WebView2 both handle this baseline.
    target: "safari15",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
