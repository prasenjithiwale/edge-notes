// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { DockPhase } from "../lib/ipc";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

const { Tab } = await import("./Tab");
const { useDockStore } = await import("../store/dock");
const { useSettingsStore } = await import("../store/settings");

const BASE = useSettingsStore.getState().settings;

function appearanceAt(phase: DockPhase, appearance: "translucent" | "solid"): string | null {
  useDockStore.setState({ phase });
  useSettingsStore.setState({ settings: { ...BASE, "tab.appearance": appearance } });
  const { container } = render(<Tab className="" />);
  return container.firstElementChild?.getAttribute("data-appearance") ?? null;
}

beforeEach(() => {
  useSettingsStore.setState({ settings: BASE });
});

afterEach(() => {
  cleanup();
});

describe("tab appearance", () => {
  it("is translucent while collapsed by default", () => {
    expect(appearanceAt("collapsed", "translucent")).toBe("translucent");
  });

  it("turns solid while the panel is out, to match the panel", () => {
    expect(appearanceAt("opening", "translucent")).toBe("solid");
    expect(appearanceAt("open", "translucent")).toBe("solid");
  });

  it("stays solid when the setting says so", () => {
    expect(appearanceAt("collapsed", "solid")).toBe("solid");
  });
});
