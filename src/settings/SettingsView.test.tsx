// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Settings } from "../lib/ipc";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

const { SettingsView } = await import("./SettingsView");
const { useSettingsStore } = await import("../store/settings");

const BASE = useSettingsStore.getState().settings;

const APP_INFO = {
  name: "Ledge",
  version: "1.2.3",
  os: "macOS",
  arch: "aarch64",
  dataDir: "/Users/someone/Library/Application Support/dev.ledge.app",
};

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
    if (command === "app_info") {
      return Promise.resolve(APP_INFO);
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
      const { accelerator } = args as { which: string; accelerator: string };
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

describe("tab size setting", () => {
  it("defaults to medium and applies a new size straight away", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(screen.getByRole("button", { name: "Medium" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    screen.getByRole("button", { name: "Large" }).click();

    // Painted before it is stored: the tab is on screen while you choose.
    expect(document.documentElement.style.getPropertyValue("--tab-pill-width")).toBe("16.8px");
    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "tab.size": "large" } }]);
    });
  });

  it("scales the window and the pill together", () => {
    useSettingsStore.setState({ settings: { ...BASE, "tab.size": "small" } });
    render(<SettingsView onClose={() => undefined} />);
    screen.getByRole("button", { name: "Small" }).click();

    const root = document.documentElement.style;
    // The hit area grows with the paint, so a bigger tab is easier to hit and
    // not only easier to see.
    expect(root.getPropertyValue("--tab-width")).toBe("17.6px");
    expect(root.getPropertyValue("--tab-pill-width")).toBe("9.6px");
    expect(root.getPropertyValue("--tab-height")).toBe("57.6px");
    expect(root.getPropertyValue("--tab-pill-height")).toBe("41.6px");
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
      ).toEqual([["shortcut_set", { which: "newNote", accelerator: "Shift+Cmd+KeyJ" }]]);
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

describe("the About section", () => {
  it("shows the version, the system and where the notes live", async () => {
    render(<SettingsView onClose={() => undefined} />);

    expect(await screen.findByText("1.2.3")).toBeTruthy();
    expect(screen.getByText("Ledge")).toBeTruthy();
    expect(screen.getByText(/macOS/)).toBeTruthy();
    expect(screen.getByText(/dev\.ledge\.app/)).toBeTruthy();
  });

  it("copies the details as something that can be pasted into a message", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });

    render(<SettingsView onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(written).toEqual(["Ledge 1.2.3\nmacOS aarch64\nData: " + APP_INFO.dataDir]);
    });
    // And says it happened, since nothing else on screen changes.
    await screen.findByRole("button", { name: "Copied" });
  });

  /**
   * Downloads, the changelog and the issue tracker, each through `open_url` —
   * the one command allowed to leave the app — and each at an address a reader
   * can actually open. The source repository is private, so a link into it from
   * inside the app would be a dead end for everyone but its author.
   */
  it("opens the public pages through the one command that may", async () => {
    render(<SettingsView onClose={() => undefined} />);
    const opens = await screen.findAllByRole("button", { name: "Open" });
    expect(opens).toHaveLength(3);
    for (const button of opens) {
      fireEvent.click(button);
    }

    await waitFor(() => {
      const urls = invoke.mock.calls
        .filter(([command]) => command === "open_url")
        .map(([, args]) => (args as { url: string }).url);
      expect(urls).toHaveLength(3);
      expect(urls.every((url) => url.startsWith("https://"))).toBe(true);
      expect(urls.some((url) => url.endsWith("changelog.html"))).toBe(true);
      expect(urls.some((url) => url.endsWith("/issues"))).toBe(true);
      // Never the private one. "edge-notes-apt" is a different repository, and
      // the boundary after the name is what tells them apart.
      expect(urls.some((url) => /edge-notes(\/|$)/.test(url))).toBe(false);
    });
  });

  /** A version box that says "unknown" is worse than no version box. */
  it("is left out entirely when the details cannot be read", async () => {
    invoke.mockImplementation((command: string) => {
      if (command === "app_info") {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject({ code: "unknown", message: "no" });
      }
      if (command === "monitors_list") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

    render(<SettingsView onClose={() => undefined} />);

    await screen.findByText("Appearance");
    expect(screen.queryByText("About")).toBeNull();
  });
});

describe("updates", () => {
  function withUpdates(status: unknown, check: unknown = null) {
    const base = invoke.getMockImplementation();
    invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "update_status") {
        return Promise.resolve(status);
      }
      if (command === "update_check") {
        return Promise.resolve(check);
      }
      return base ? base(command, args) : Promise.resolve(null);
    });
  }

  /** A .deb is apt's to update; a button there would only fail. */
  it("says why a copy cannot update itself, with nothing to press", async () => {
    withUpdates({ unavailable: "This copy is updated by apt: sudo apt upgrade.", found: null });
    render(<SettingsView onClose={() => undefined} />);

    await screen.findByText("This copy is updated by apt: sudo apt upgrade.");
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
  });

  it("checks on request and says when there is nothing new", async () => {
    withUpdates({ unavailable: null, found: null }, null);
    render(<SettingsView onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    await screen.findByText("Ledge is up to date.");
  });

  it("offers a found version and installs it through Rust", async () => {
    withUpdates({ unavailable: null, found: null }, { version: "9.9.9", notes: null });
    render(<SettingsView onClose={() => undefined} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check" }));
    await screen.findByText("Version 9.9.9 is available");
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(invoke.mock.calls.some(([command]) => command === "update_install")).toBe(true);
    });
  });
});
