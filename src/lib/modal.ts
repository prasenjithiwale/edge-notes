import { dockSetModal } from "./ipc";

/**
 * Hold the panel open while a window of *ours* is in front of it.
 *
 * A file picker or a share sheet takes focus, and brief 6.3 reads a blur with
 * the cursor away from the panel as everyone having left — the panel would
 * slide shut behind the very thing it opened. `dock_set_modal` is the flag that
 * says this blur is not that.
 *
 * The release is what matters: a panel left holding itself open for a picker
 * that has gone is a panel that never closes again. So it happens when the work
 * finishes, when the window is focused again, and on a timeout, whichever comes
 * first — and releasing twice is harmless, because the flag is a state and not
 * a count.
 */
const FALLBACK_MS = 60_000;

export async function withModal<T>(run: () => Promise<T>): Promise<T> {
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    window.removeEventListener("focus", onFocus);
    clearTimeout(timer);
    void dockSetModal(false);
  };
  const onFocus = () => {
    // A frame for whatever the window was showing to finish closing.
    setTimeout(release, 300);
  };
  const timer = setTimeout(release, FALLBACK_MS);

  void dockSetModal(true);
  window.addEventListener("focus", onFocus);
  try {
    return await run();
  } catch (error: unknown) {
    release();
    throw error;
  }
}
