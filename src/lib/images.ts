/**
 * Where a note's pictures come from (idea 17).
 *
 * A note stores `![alt](ledge://localhost/<name>)`. That is the *stored* form
 * and it is the same on every platform; the URL a webview can actually load is
 * not, because Windows serves a custom scheme as `http://<scheme>.localhost`.
 * `convertFileSrc` is Tauri's own answer to that difference, so it is the only
 * thing here that knows about it.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

/** How an image is written into a note. Rust's sweep looks for this too. */
export const IMAGE_PREFIX = "ledge://localhost/";

/** The markdown for an image, which is all a note ever holds of one. */
export function imageMarkdown(name: string, alt = ""): string {
  return `![${alt}](${IMAGE_PREFIX}${name})`;
}

/**
 * A `src` a webview can load, or null for anything that is not one of ours.
 *
 * Null rather than the URL itself: the note text is the user's, a remote URL in
 * it would be a request this app never makes on their behalf, and the CSP would
 * refuse it anyway. Better to draw nothing than to draw a broken image.
 */
export function imageSrc(url: string): string | null {
  if (!url.startsWith(IMAGE_PREFIX)) {
    return null;
  }
  const name = url.slice(IMAGE_PREFIX.length);
  if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/i.test(name)) {
    return null;
  }
  return convertFileSrc(name, "ledge");
}
