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
    // Vitest blanks CSS by default, which also empties `?raw` imports. Three
    // tests read stylesheets rather than rendering them — the palette's
    // contrast, the `user-select` pairs that decide whether text can be selected
    // at all, and the `:focus-visible` qualifier that decides whether a rule
    // turning the focus ring off actually wins — so those sheets are let through
    // and the rest stay blank.
    css: {
      include: [
        /tokens\.css/,
        /global\.css/,
        /NoteCard\.module\.css/,
        // The panel's own colour is read out of these two by accent.test.ts.
        /Panel\.module\.css/,
        /PomodoroView\.module\.css/,
        /NoteEditor\.module\.css/,
        /NoteReader\.module\.css/,
        /NoteText\.module\.css/,
        /RichEditor\.module\.css/,
        /CodeNode\.module\.css/,
        /SearchField\.module\.css/,
        /TasksView\.module\.css/,
        /TaskDetails\.module\.css/,
      ],
    },
  },
});
