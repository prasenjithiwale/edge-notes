/**
 * Putting text on the clipboard, from the two places that do it.
 *
 * The Clipboard API is the right one and works in a Tauri webview, which is a
 * secure context; the textarea fallback is for the engines and the test
 * environment where it is missing, and costs four lines. Neither throws: a copy
 * that did not happen returns false, and the caller says nothing rather than
 * claiming it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* falls through to the older path */
  }
  try {
    const carrier = document.createElement("textarea");
    carrier.value = text;
    carrier.setAttribute("readonly", "");
    carrier.style.position = "fixed";
    carrier.style.opacity = "0";
    document.body.appendChild(carrier);
    carrier.select();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the fallback.
    const copied = document.execCommand("copy");
    document.body.removeChild(carrier);
    return copied;
  } catch {
    return false;
  }
}
