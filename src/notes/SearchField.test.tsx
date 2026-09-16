// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { SearchField } = await import("./SearchField");
const { useDockStore } = await import("../store/dock");

function locked(): boolean {
  return useDockStore.getState().locks.has("search");
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useDockStore.setState({ locks: new Set() });
});

afterEach(() => {
  cleanup();
});

/**
 * The panel must not slide away while someone is typing a query (brief 6.3).
 */
describe("the search field's hold on the panel", () => {
  it("holds the lock once focused, under StrictMode's mount/cleanup/mount", async () => {
    // main.tsx renders inside StrictMode. Acquiring the lock in onFocus while
    // releasing it in an effect cleanup used to lose it here: the cleanup
    // dropped the lock and re-focusing an already-focused input fires no event,
    // so nothing took it back and the panel closed mid-search.
    render(
      <StrictMode>
        <SearchField query="" what="notes" onQueryChange={() => undefined} onAbandon={() => undefined} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(locked()).toBe(true);
    });
  });

  it("releases the lock on blur", async () => {
    const { getByLabelText } = render(
      <SearchField query="milk" what="notes" onQueryChange={() => undefined} onAbandon={() => undefined} />,
    );
    await waitFor(() => {
      expect(locked()).toBe(true);
    });

    (getByLabelText("Search notes") as HTMLInputElement).blur();
    await waitFor(() => {
      expect(locked()).toBe(false);
    });
  });

  it("releases the lock when it unmounts while still focused", async () => {
    const view = render(
      <SearchField query="milk" what="notes" onQueryChange={() => undefined} onAbandon={() => undefined} />,
    );
    await waitFor(() => {
      expect(locked()).toBe(true);
    });

    view.unmount();
    expect(locked()).toBe(false);
  });
});
