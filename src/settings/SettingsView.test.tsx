// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Settings } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { SettingsView } = await import("./SettingsView");
const { useSettingsStore } = await import("../store/settings");

const BASE = useSettingsStore.getState().settings;

function updates(): unknown[] {
  return invoke.mock.calls
    .filter(([command]) => command === "settings_update")
    .map(([, args]) => args);
}

beforeEach(() => {
  // The shortcut is drawn with macOS symbols or spelled-out names depending on
  // the platform; pin it so the assertions below can read as they would on a Mac.
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "monitors_list") {
      return Promise.resolve([]);
    }
    if (command === "settings_update") {
      const { patch } = args as { patch: Partial<Settings> };
      return Promise.resolve({ ...useSettingsStore.getState().settings, ...patch });
    }
    if (command === "autostart_get") {
      return Promise.resolve(false);
    }
    if (command === "autostart_set") {
      return Promise.resolve((args as { enabled: boolean }).enabled);
    }
    if (command === "shortcut_set") {
      const { accelerator } = args as { accelerator: string };
      return Promise.resolve({
        ...useSettingsStore.getState().settings,
        "shortcut.newNote": accelerator,
      });
    }
    return Promise.resolve(null);
  });
  useSettingsStore.setState({ settings: BASE });
});

afterEach(() => {
  cleanup();
});

describe("open panel setting", () => {
  it("defaults to hover and switches to click", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "On hover" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    screen.getByRole("button", { name: "On click" }).click();

    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "dock.openOn": "click" } }]);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "On click" }).getAttribute("aria-pressed"),
      ).toBe("true");
    });
  });

  it("disables the open delay in click mode, where it does nothing", () => {
    useSettingsStore.setState({ settings: { ...BASE, "dock.openOn": "click" } });
    render(<SettingsView onClose={() => undefined} />);

    // The two delays and the panel width live under Advanced now: they are worth
    // having and not worth being among the first things anyone sees.
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByLabelText(/^Open delay/)).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(/^Close delay/)).toHaveProperty("disabled", false);
  });
});

describe("tab appearance setting", () => {
  it("defaults to translucent and switches to solid", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(
      screen.getByRole("button", { name: "Translucent" }).getAttribute("aria-pressed"),
    ).toBe("true");
    screen.getByRole("button", { name: "Solid" }).click();

    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "tab.appearance": "solid" } }]);
    });
  });
});

describe("panel translucency setting", () => {
  it("shows the percentage, previews while dragging and stores on release", async () => {
    render(<SettingsView onClose={() => undefined} />);
    const slider = screen.getByLabelText<HTMLInputElement>(/^Panel translucency/);
    expect(screen.getByText("0%")).toBeTruthy();

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "35" } });

    expect(screen.getByText("35%")).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--panel-alpha")).toBe("0.65");
    expect(updates()).toEqual([]);

    fireEvent.pointerUp(slider);
    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "panel.translucency": 35 } }]);
    });
  });

  it("does not store a release that changed nothing", () => {
    render(<SettingsView onClose={() => undefined} />);
    const slider = screen.getByLabelText(/^Panel translucency/);
    fireEvent.pointerDown(slider);
    fireEvent.pointerUp(slider);
    expect(updates()).toEqual([]);
  });
});

describe("task reminders setting", () => {
  it("is on by default and can be turned off", async () => {
    render(<SettingsView onClose={() => undefined} />);
    const toggle = screen.getByRole("switch", { name: "Task reminders" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "tasks.reminders": false } }]);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Task reminders" }).getAttribute("aria-checked"),
      ).toBe("false");
    });
  });
});

describe("the Focus settings", () => {
  it("nudges a phase length rather than asking for it to be typed", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(screen.getByText("25 min")).toBeTruthy();
    screen.getByRole("button", { name: "Session: more" }).click();

    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "focus.focusMinutes": 30 } }]);
    });
  });

  it("stops at the ends of the range instead of going past them", () => {
    useSettingsStore.setState({ settings: { ...BASE, "focus.longBreakEvery": 2 } });
    render(<SettingsView onClose={() => undefined} />);

    const fewer = screen.getByRole("button", { name: "Long break after: less" });
    expect(fewer).toHaveProperty("disabled", true);
    fewer.click();
    expect(updates()).toEqual([]);
  });

  it("offers auto-start, off by default", async () => {
    render(<SettingsView onClose={() => undefined} />);

    const toggle = screen.getByRole("switch", { name: "Start the next phase" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "focus.autoStart": true } }]);
    });
  });
});

describe("dock side setting", () => {
  it("moves the dock to the other edge, without going to the tray for it", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "Right" }).getAttribute("aria-pressed")).toBe("true");
    screen.getByRole("button", { name: "Left" }).click();

    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "dock.side": "left" } }]);
    });
  });
});

describe("launch at login setting", () => {
  it("reads the state from the OS and writes it back", async () => {
    render(<SettingsView onClose={() => undefined} />);

    // autostart_get resolves false in the mock, so the switch starts off.
    const toggle = await screen.findByRole("switch", { name: "Launch at login" });
    await waitFor(() => {
      expect(toggle.getAttribute("aria-checked")).toBe("false");
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([command]) => command === "autostart_set"),
      ).toEqual([["autostart_set", { enabled: true }]]);
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Launch at login" }).getAttribute("aria-checked"),
      ).toBe("true");
    });
  });
});

describe("the new note shortcut", () => {
  it("records the keys pressed instead of asking for accelerator syntax", async () => {
    render(<SettingsView onClose={() => undefined} />);

    const recorder = screen.getByRole("button", { name: "New note shortcut" });
    expect(recorder.textContent).toBe("⌘⌥N");

    fireEvent.click(recorder);
    expect(screen.getByRole("button", { name: "New note shortcut" }).textContent).toBe(
      "Press a shortcut",
    );

    fireEvent.keyDown(window, { code: "KeyJ", metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([command]) => command === "shortcut_set"),
      ).toEqual([["shortcut_set", { accelerator: "Shift+Cmd+KeyJ" }]]);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "New note shortcut" }).textContent).toBe("⇧⌘J");
    });
  });

  it("says so when the OS refuses the shortcut, and keeps the old one", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "monitors_list") {
        return Promise.resolve([]);
      }
      if (command === "shortcut_set") {
        // Tauri rejects with the serialized `AppError` object, not an Error, and
        // this is the shape `isIpcErrorOf` has to recognise.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject({
          code: "shortcut_unavailable",
          message: "HotKey already registered",
        });
      }
      return Promise.resolve(null);
    });
    render(<SettingsView onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "New note shortcut" }));
    fireEvent.keyDown(window, { code: "KeyN", metaKey: true, altKey: true });

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Another app is using that shortcut");
    });
    // Still showing the accelerator that is actually bound.
    expect(screen.getByRole("button", { name: "New note shortcut" }).textContent).toBe("⌘⌥N");
  });

  it("ignores a press with no modifier rather than binding a bare key", async () => {
    render(<SettingsView onClose={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "New note shortcut" }));
    fireEvent.keyDown(window, { code: "KeyN" });

    await waitFor(() => {
      expect(screen.getByText(/Hold/).textContent).toContain("Hold");
    });
    expect(invoke.mock.calls.filter(([command]) => command === "shortcut_set")).toEqual([]);
  });
});
