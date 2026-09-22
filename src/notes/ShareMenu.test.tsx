// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));

const { ShareMenu } = await import("./ShareMenu");

const IMAGE = "ledge://localhost/0199a000-0000-7000-8000-000000000001.png";
const NOTE = `Shopping\n- milk\n![the graph|320](${IMAGE})`;

function argsFor(command: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((command) =>
    Promise.resolve(command === "share_sheet_supported" ? true : undefined),
  );
  // The pictures are fetched through the app's own scheme to be embedded.
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) } as Response),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * What leaves the app. The rich-text path is the one that matters most: Apple
 * Notes and OneNote read HTML and neither reads Markdown, so a note copied for
 * them has to arrive as formatting — with its pictures carried along, because a
 * `ledge://` link means nothing anywhere else.
 */
describe("sharing a note", () => {
  it("copies rich text and plain text together, with the picture embedded", async () => {
    render(<ShareMenu content={NOTE} />);
    fireEvent.click(screen.getByRole("button", { name: "Share note" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Copy as rich text/ }));

    await waitFor(() => {
      expect(argsFor("share_copy_rich")).toHaveLength(1);
    });
    const sent = argsFor("share_copy_rich")[0] ?? {};
    expect(sent["html"]).toContain("<ul><li>milk</li></ul>");
    expect(sent["html"]).toContain('src="data:');
    expect(sent["html"]).toContain('width="320"');
    // The plain half carries no link only this app can follow.
    expect(sent["text"]).toBe("Shopping\n- milk\n[the graph]");
  });

  it("copies the Markdown exactly as the note is stored", async () => {
    render(<ShareMenu content={NOTE} />);
    fireEvent.click(screen.getByRole("button", { name: "Share note" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Copy as Markdown/ }));

    await waitFor(() => {
      expect(argsFor("share_copy_text")).toEqual([{ text: NOTE }]);
    });
  });

  it("holds the panel open while the system's sheet is up", async () => {
    render(<ShareMenu content={NOTE} />);
    fireEvent.click(screen.getByRole("button", { name: "Share note" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Share…/ }));

    await waitFor(() => {
      expect(argsFor("share_sheet")).toHaveLength(1);
    });
    // Taken before the sheet, and the picture goes as a file rather than inline.
    expect(argsFor("dock_set_modal")[0]).toEqual({ value: true });
    expect(argsFor("share_sheet")[0]?.["images"]).toEqual([
      "0199a000-0000-7000-8000-000000000001.png",
    ]);
  });

  it("offers no system sheet where there is none", async () => {
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "share_sheet_supported" ? false : undefined),
    );
    render(<ShareMenu content={NOTE} />);
    fireEvent.click(screen.getByRole("button", { name: "Share note" }));

    expect(await screen.findByRole("menuitem", { name: /Copy as rich text/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Share…/ })).toBeNull();
  });
});
