// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { DockPhase } from "../lib/ipc";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

const { Tab } = await import("./Tab");
const { useDockStore } = await import("../store/dock");
const { useSettingsStore } = await import("../store/settings");
const { usePomodoroStore } = await import("../store/pomodoro");
const { idle, start } = await import("../lib/pomodoro");

const BASE = useSettingsStore.getState().settings;

function appearanceAt(phase: DockPhase, appearance: "translucent" | "solid"): string | null {
  useDockStore.setState({ phase });
  useSettingsStore.setState({ settings: { ...BASE, "tab.appearance": appearance } });
  const { container } = render(<Tab className="" />);
  return container.firstElementChild?.getAttribute("data-appearance") ?? null;
}

beforeEach(() => {
  useSettingsStore.setState({ settings: BASE });
  usePomodoroStore.setState({ state: idle() });
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

/**
 * The collapsed tab is the only part of the app on screen while you are working
 * in something else, so a session counting down behind it has to say so there.
 */
describe("the running-session light", () => {
  const light = (container: HTMLElement) =>
    container.querySelector('[aria-label="Focus session running"]');

  it("is absent while nothing is running", () => {
    const { container } = render(<Tab className="" />);
    expect(light(container)).toBeNull();
  });

  it("appears while a session is counting", () => {
    usePomodoroStore.setState({ state: start(idle(), Date.now()) });
    const { container } = render(<Tab className="" />);
    expect(light(container)).not.toBeNull();
  });

  it("is absent again once the phase is paused", () => {
    usePomodoroStore.setState({ state: idle() });
    const { container } = render(<Tab className="" />);
    expect(light(container)).toBeNull();
  });

  /**
   * The timer's state only advances when something asks it to, and while the
   * panel is collapsed nothing does. Without watching for the end as well as the
   * start, a session that ran out an hour ago would still be shown as running.
   */
  it("is absent for a session whose time has already run out", () => {
    const now = Date.now();
    usePomodoroStore.setState({ state: { ...start(idle(), now), endsAt: now - 60_000 } });
    const { container } = render(<Tab className="" />);
    expect(light(container)).toBeNull();
  });

  it("goes out by itself when the phase ends, with the panel still closed", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const now = Date.now();
      usePomodoroStore.setState({ state: { ...start(idle(), now), endsAt: now + 1_000 } });
      const { container } = render(<Tab className="" />);
      expect(light(container)).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(1_100);
      });
      expect(light(container)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
