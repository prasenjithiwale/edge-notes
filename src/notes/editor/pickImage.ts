import { imagesSave } from "../../lib/ipc";
import { withModal } from "../../lib/modal";

/** What the picker will offer, and what `images::sniff` will accept. */
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Ask for image files and store them; the names come back in the order chosen.
 *
 * A hidden `<input type="file">` rather than a dialog plugin: the picker is the
 * same native one either way, and this needs no dependency and no filesystem
 * permission — the webview reads the bytes the user handed it and passes them to
 * the same command a paste uses.
 *
 * **The panel is held open while the picker is up** (`withModal`). The picker
 * takes focus, and a blur with the cursor away from the panel is how the panel
 * knows everyone has left (brief 6.3) — without this it would slide shut and
 * take the editor, and the caret the image was going to land at, with it.
 */
export async function pickImages(): Promise<string[]> {
  return withModal(pick);
}

async function pick(): Promise<string[]> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ACCEPT;
  input.multiple = true;
  // Firefox needs it in the document; Safari does not mind either way.
  input.style.display = "none";
  document.body.append(input);

  try {
    const files = await new Promise<File[]>((resolve) => {
      // `cancel` fires when the picker is dismissed; `focus` on the window is
      // the fallback for anywhere it does not, so the panel is never left
      // holding itself open for a picker that has gone.
      const done = (value: File[]) => {
        window.removeEventListener("focus", onWindowFocus);
        resolve(value);
      };
      const onWindowFocus = () => {
        // A frame for `change` to arrive first: focus comes back either way.
        setTimeout(() => {
          done([...(input.files ?? [])]);
        }, 300);
      };
      input.addEventListener("change", () => {
        done([...(input.files ?? [])]);
      });
      input.addEventListener("cancel", () => {
        done([]);
      });
      window.addEventListener("focus", onWindowFocus);
      input.click();
    });

    const names: string[] = [];
    for (const file of files) {
      try {
        names.push(await imagesSave(new Uint8Array(await file.arrayBuffer())));
      } catch (error: unknown) {
        // One file failing is not the rest failing: a folder of screenshots with
        // a stray PDF in it should still put the screenshots in.
        console.error(`images: ${file.name} could not be stored`, error);
      }
    }
    return names;
  } finally {
    input.remove();
  }
}
