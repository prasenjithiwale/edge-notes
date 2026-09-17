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
  "tab.size": "medium",
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

/**
 * The default tab metrics, and what each size multiplies them by.
 *
 * The same three factors as `TabSize::scale` in Rust, which sizes the window and
 * the hit area from them. They are written down twice because the window is
 * Rust's and the paint is CSS's; `src/dock/tabSize.test.ts` checks the two lists
 * against each other so they cannot drift apart.
 */
export const TAB_SCALES: Record<Settings["tab.size"], number> = {
  small: 0.8,
  medium: 1,
  large: 1.4,
};

const TAB_BASE = { width: 22, height: 72, pillWidth: 12, pillHeight: 52 };

/**
 * `tab.size` as the four lengths the tab is drawn from. Set on the root the way
 * the translucency is, so the settings view can show a size the moment it is
 * picked rather than after a round trip to Rust.
 */
export function applyTabSize(size: Settings["tab.size"]): void {
  const scale = TAB_SCALES[size];
  const root = document.documentElement;
  // To a tenth of a pixel: `12 * 1.4` is 16.799999999999997 in binary floating
  // point, and that would go into the stylesheet exactly as written.
  const px = (base: number) => `${String(Math.round(base * scale * 10) / 10)}px`;
  root.style.setProperty("--tab-width", px(TAB_BASE.width));
  root.style.setProperty("--tab-height", px(TAB_BASE.height));
  root.style.setProperty("--tab-pill-width", px(TAB_BASE.pillWidth));
  root.style.setProperty("--tab-pill-height", px(TAB_BASE.pillHeight));
}

function applyAppearance(settings: Settings): void {
  applyTheme(settings.theme);
  applyPanelTranslucency(settings["panel.translucency"]);
  applyTabSize(settings["tab.size"]);
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
