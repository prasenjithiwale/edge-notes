// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

const { LockedView } = await import("./LockedView");
type Status = Parameters<typeof LockedView>[0]["status"];

const LOCKED: Status = {
  captureProtection: true,
  protection: "locked",
  detail: "the notes are encrypted and this system's keychain has no key for them",
};
const OPEN: Status = { captureProtection: true, protection: "on", detail: "" };

const KEY = "A1B2C3D4-E5F6A7B8-C9D0E1F2-A3B4C5D6-E7F8A9B0-C1D2E3F4-A5B6C7D8-E9F0A1B2";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

/**
 * The locked panel is the only way back into an encrypted database whose key has
 * gone. Everything here is about not losing notes: the reason is shown, a key
 * that does not work says so rather than doing anything, and the one destructive
 * path asks first and only ever renames.
 */
describe("the locked panel", () => {
  it("says why it is locked, in the words Rust used", () => {
    render(<LockedView status={LOCKED} onUnlocked={() => undefined} />);
    expect(screen.getByText(/keychain has no key for them/i)).toBeTruthy();
  });

  it("will not try an empty key", () => {
    render(<LockedView status={LOCKED} onUnlocked={() => undefined} />);
    const unlock = screen.getByRole("button", { name: "Unlock" });
    expect(unlock.hasAttribute("disabled")).toBe(true);
    fireEvent.click(unlock);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the key as typed and reports the status back", async () => {
    invoke.mockImplementation((command) =>
      command === "security_unlock" ? Promise.resolve(OPEN) : Promise.resolve(undefined),
    );
    const unlocked = vi.fn();
    render(<LockedView status={LOCKED} onUnlocked={unlocked} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("security_unlock", { recovery: KEY });
    });
    await waitFor(() => {
      expect(unlocked).toHaveBeenCalledWith(OPEN);
    });
  });

  it("unlocks on Enter, because the key is pasted and Enter is what follows", async () => {
    invoke.mockResolvedValue(OPEN);
    render(<LockedView status={LOCKED} onUnlocked={() => undefined} />);

    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: KEY } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("security_unlock", { recovery: KEY });
    });
  });

  it("says a wrong key is wrong, and changes nothing", async () => {
    invoke.mockRejectedValue({ code: "locked", message: "that key does not open these notes" });
    const unlocked = vi.fn();
    render(<LockedView status={LOCKED} onUnlocked={unlocked} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/does not open these notes/i);
    });
    expect(unlocked).not.toHaveBeenCalled();
  });

  it("asks before starting fresh, and says the locked file is kept", async () => {
    invoke.mockResolvedValue(OPEN);
    render(<LockedView status={LOCKED} onUnlocked={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Start fresh instead" }));
    expect(screen.getByText(/kept, renamed beside it/i)).toBeTruthy();
    // Asking is not doing.
    expect(invoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("security_start_fresh", undefined);
    });
  });

  it("lets the question be dropped", () => {
    render(<LockedView status={LOCKED} onUnlocked={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Start fresh instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Start fresh" })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
