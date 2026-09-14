/**
 * Brief 7.5: no browser context menu in production builds — "Reload" and
 * "Inspect Element" make a widget feel like a web page — except where it is
 * genuinely useful.
 *
 * Kept: text fields, for cut, copy and paste; and any selected text, because a
 * pinned card's text is selectable precisely so it can be copied in place, and
 * the context menu is the discoverable way to do that.
 */
export function allowsContextMenu(
  target: EventTarget | null,
  selection: string,
): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return true;
  }
  return selection.trim() !== "";
}

/** Install the production context-menu rule on a window. Returns the remover. */
export function suppressContextMenu(win: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    const selection = win.getSelection()?.toString() ?? "";
    if (!allowsContextMenu(event.target, selection)) {
      event.preventDefault();
    }
  };
  win.addEventListener("contextmenu", onContextMenu);
  return () => {
    win.removeEventListener("contextmenu", onContextMenu);
  };
}
