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
    // Pure logic runs in node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock, so the fast majority stay fast.
    environment: "node",
    // Fills in the measuring jsdom does not do. See the file for why the editor
    // cannot manage without it.
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Vitest blanks CSS by default, which also empties `?raw` imports. The
    // contrast test reads the palette straight from tokens.css, so that one
    // file is let through.
    css: { include: [/tokens\.css/] },
  },
});
