// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));

/**
 * Counts how often the editor's body renders, by standing in front of one of
 * the plugins it renders. The real plugin still runs, so the behaviour under
 * test — registering a node transform, which commits an update — is unchanged.
 */
let bodyRenders = 0;
vi.mock("@lexical/react/LexicalAutoLinkPlugin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lexical/react/LexicalAutoLinkPlugin")>();
  return {
    ...actual,
    AutoLinkPlugin: (props: Parameters<typeof actual.AutoLinkPlugin>[0]) => {
      bodyRenders += 1;
      return <actual.AutoLinkPlugin {...props} />;
    },
  };
});

const { NoteEditor } = await import("../NoteEditor");

afterEach(() => {
  cleanup();
  invoke.mockReset();
  bodyRenders = 0;
});

const note = {
  id: "1",
  content: "Standup notes\nsee https://example.test for the rest\n- milk",
  color: "yellow" as const,
  pinned: false,
  createdAt: 1_000,
  updatedAt: 1_000,
  sortOrder: null,
};

/**
 * The editor has to come to rest.
 *
 * It did not, once. `registerAutoLink` registers a node transform, and
 * registering one marks nodes dirty, which commits an update. So: a render built
 * a fresh `matchers` array, the plugin's effect saw a new dependency and
 * registered again, that committed an update, the toolbar's update listener set
 * a fresh state object, and React rendered again. It never stopped — the app
 * froze, and once the loop had allocated enough the kernel killed it.
 *
 * Neither symptom looks like a failing test, so this one counts renders. On the
 * code as 0.2.0 shipped it, this reaches 420 renders in the first window and 960
 * in the second, climbing; fixed, it settles in single figures and stays there.
 */
describe("the editor settles after it opens", () => {
  it("stops rendering instead of looping", async () => {
    render(<NoteEditor note={note} />);
    await waitFor(() => {
      expect(bodyRenders).toBeGreaterThan(0);
    });

    // Long enough for a loop to run away, short enough to keep the suite quick.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = bodyRenders;
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(bodyRenders).toBe(settled);
    // And it got there in a handful of passes, not hundreds.
    expect(settled).toBeLessThan(25);
  });
});
