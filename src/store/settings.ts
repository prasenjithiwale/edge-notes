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
  "dock.openOn": "hover",
  "tab.appearance": "translucent",
  "panel.width": 320,
  theme: "system",
  "notes.lastColor": "yellow",
  "notes.lastCodeLang": "",
  "shortcut.newNote": "CmdOrCtrl+Alt+N",
  "tasks.reminders": true,
  "panel.translucency": 0,
  "focus.focusMinutes": 25,
  "focus.breakMinutes": 5,
  "focus.longBreakMinutes": 15,
  "focus.longBreakEvery": 4,
  "focus.autoStart": false,
  "focus.taskId": "",
  "focus.day": "",
  "focus.today": 0,
  "focus.streak": 0,
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

/**
 * `panel.translucency` as the panel's surface opacity. Set on the root so the
 * settings slider can preview a value while it is dragged, without a write per
 * step, and the stored value takes over when it is released.
 */
export function applyPanelTranslucency(percent: number): void {
  const clamped = Math.min(Math.max(percent, 0), 100);
  document.documentElement.style.setProperty("--panel-alpha", String(1 - clamped / 100));
}

function applyAppearance(settings: Settings): void {
  applyTheme(settings.theme);
  applyPanelTranslucency(settings["panel.translucency"]);
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
      applyAppearance(settings);
      set({ settings, loaded: true });
    } catch (error: unknown) {
      // Defaults are already in place, so the panel still works.
      console.error("settings: load failed", error);
      set({ loaded: true });
    }
  },
  apply: (settings) => {
    applyAppearance(settings);
    set({ settings });
  },
  patch: async (patch) => {
    try {
      const settings = await settingsUpdate(patch);
      applyAppearance(settings);
      set({ settings });
    } catch (error: unknown) {
      console.error("settings: update failed", error);
    }
  },
  lastColor: () => get().settings["notes.lastColor"],
}));
