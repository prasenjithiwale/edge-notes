// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
const listen = vi.fn<(event: string, handler: unknown) => Promise<() => void>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: unknown) => listen(event, handler),
}));

const { App } = await import("../App");

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
  invoke.mockResolvedValue([]);
  listen.mockResolvedValue(() => undefined);
});

afterEach(() => {
  cleanup();
});

/**
 * The window is created hidden and Rust shows it only when the frontend calls
 * `app_ready` (brief 7.5). If that call is ever missed the widget is invisible
 * forever, with nothing on stderr — which is exactly what happened once.
 */
describe("startup handshake", () => {
  it("calls app_ready once mounted", async () => {
    render(<App />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("app_ready", undefined);
    });
  });

  it("calls app_ready under StrictMode, which double-invokes effects", async () => {
    // main.tsx renders inside StrictMode, so the mount/cleanup/mount cycle is
    // the path that actually ships in dev.
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("app_ready", undefined);
    });
  });

  it("still calls app_ready when the dock:state listener fails", async () => {
    // Nothing about showing the window depends on the subscription succeeding,
    // and a widget that never appears is far worse than one that misses an
    // event. A rejected listen() must not strand the window hidden.
    listen.mockRejectedValue(new Error("listen unavailable"));
    render(<App />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("app_ready", undefined);
    });
  });
});
