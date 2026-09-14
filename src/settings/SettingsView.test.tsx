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
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "monitors_list") {
      return Promise.resolve([]);
    }
    if (command === "settings_update") {
      const { patch } = args as { patch: Partial<Settings> };
      return Promise.resolve({ ...useSettingsStore.getState().settings, ...patch });
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
    const group = screen.getByRole("group", { name: "Task reminders" });
    const on = Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "On");
    const off = Array.from(group.querySelectorAll("button")).find((b) => b.textContent === "Off");
    expect(on?.getAttribute("aria-pressed")).toBe("true");

    off?.click();
    await waitFor(() => {
      expect(updates()).toEqual([{ patch: { "tasks.reminders": false } }]);
    });
  });
});
