import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { useDockStore } = await import("./dock");

function lockCalls(): unknown[] {
  return invoke.mock.calls
    .filter(([command]) => command === "dock_set_interaction_lock")
    .map(([, args]) => args);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useDockStore.setState({ locks: new Set() });
});

/**
 * The editor and the search field can both hold the panel open (brief 6.3).
 * Rust still sees a single boolean, so the store has to aggregate.
 */
describe("interaction lock", () => {
  it("tells Rust when the first owner takes the lock", () => {
    useDockStore.getState().setLock("editor", true);
    expect(lockCalls()).toEqual([{ value: true }]);
  });

  it("does not repeat itself when a second owner joins", () => {
    useDockStore.getState().setLock("editor", true);
    useDockStore.getState().setLock("search", true);
    expect(lockCalls()).toEqual([{ value: true }]);
  });

  it("holds the lock while another owner still needs it", () => {
    // Closing the editor while the search field has focus must not release it.
    useDockStore.getState().setLock("editor", true);
    useDockStore.getState().setLock("search", true);
    useDockStore.getState().setLock("editor", false);
    expect(lockCalls()).toEqual([{ value: true }]);
  });

  it("releases only once the last owner lets go", () => {
    useDockStore.getState().setLock("editor", true);
    useDockStore.getState().setLock("search", true);
    useDockStore.getState().setLock("editor", false);
    useDockStore.getState().setLock("search", false);
    expect(lockCalls()).toEqual([{ value: true }, { value: false }]);
  });

  it("ignores an owner releasing a lock it never took", () => {
    useDockStore.getState().setLock("search", false);
    expect(lockCalls()).toEqual([]);
  });
});
