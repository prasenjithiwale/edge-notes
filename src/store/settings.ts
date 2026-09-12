import { create } from "zustand";

import {
  settingsGet,
  settingsUpdate,
  type NoteColor,
  type Settings,
  type SettingsPatch,
} from "../lib/ipc";

const DEFAULTS: Settings = {
  "dock.side": "right",
  "dock.monitor": "primary",
  "dock.tabOffset": 0.5,
  "dock.openDelayMs": 120,
  "dock.closeDelayMs": 400,
  "panel.width": 320,
  theme: "system",
  "notes.lastColor": "yellow",
  "shortcut.newNote": "CmdOrCtrl+Alt+N",
};

/**
 * Brief 9.2 `theme`. "system" leaves the attribute off so the media query in
 * tokens.css decides; an explicit choice stamps the root and wins over it.
 */
function applyTheme(theme: Settings["theme"]): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  apply: (settings: Settings) => void;
  patch: (patch: SettingsPatch) => Promise<void>;
  lastColor: () => NoteColor;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    try {
      const settings = await settingsGet();
      applyTheme(settings.theme);
      set({ settings, loaded: true });
    } catch (error: unknown) {
      // Defaults are already in place, so the panel still works.
      console.error("settings: load failed", error);
      set({ loaded: true });
    }
  },
  apply: (settings) => {
    applyTheme(settings.theme);
    set({ settings });
  },
  patch: async (patch) => {
    try {
      const settings = await settingsUpdate(patch);
      applyTheme(settings.theme);
      set({ settings });
    } catch (error: unknown) {
      console.error("settings: update failed", error);
    }
  },
  lastColor: () => get().settings["notes.lastColor"],
}));
