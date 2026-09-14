/**
 * No right-click menu anywhere in the widget, in any build (owner's request,
 * 14 Sep 2026). Brief 7.5 kept it in text fields and — for copying a locked
 * note — over selected text, and only suppressed it in production; the owner
 * asked for right click to be disabled outright. Cut, copy and paste remain on
 * the keyboard, and dev tools on Cmd+Opt+I in a debug build.
 */
export function suppressContextMenu(win: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  win.addEventListener("contextmenu", onContextMenu);
  return () => {
    win.removeEventListener("contextmenu", onContextMenu);
  };
}
