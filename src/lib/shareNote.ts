/**
 * One note, ready to leave the app (idea 14's neighbours).
 *
 * The pictures are the reason this is async. A note holds `ledge://` links,
 * which mean nothing outside this app, so anything shared has to carry the
 * bytes themselves — as `data:` URIs in the HTML, which is what makes a note
 * arrive complete in Apple Notes or Mail rather than with holes in it.
 */
import { IMAGE_PREFIX, imageSrc } from "./images";
import { noteToHtml, noteToText } from "./noteHtml";

export interface Shared {
  /** Rich text, with the pictures embedded. */
  html: string;
  /** The note as it is stored, minus links only this app can follow. */
  text: string;
  /** The names of the note's pictures, for a share sheet that takes files. */
  images: string[];
}

/** Every `ledge://` image the note links to, in the order written. */
export function imageNames(content: string): string[] {
  const names: string[] = [];
  const pattern = /!\[[^\]]*\]\((ledge:\/\/[^\s)]+)\)/g;
  for (const match of content.matchAll(pattern)) {
    const url = match[1] ?? "";
    const name = url.slice(IMAGE_PREFIX.length);
    if (url.startsWith(IMAGE_PREFIX) && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * The bytes of one picture as a `data:` URI, or null if it cannot be read.
 *
 * Null rather than a throw: one unreadable picture must not stop a note being
 * shared, and the HTML says `[image]` where it was.
 */
async function dataUri(url: string): Promise<string | null> {
  const src = imageSrc(url);
  if (src === null) {
    return null;
  }
  try {
    const blob = await fetch(src).then((response) =>
      response.ok ? response.blob() : Promise.reject(new Error(String(response.status))),
    );
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => {
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch (error: unknown) {
    console.error("share: could not read a picture", error);
    return null;
  }
}

export async function buildShare(content: string): Promise<Shared> {
  const names = imageNames(content);
  const embedded = new Map<string, string>();
  await Promise.all(
    names.map(async (name) => {
      const url = `${IMAGE_PREFIX}${name}`;
      const uri = await dataUri(url);
      if (uri !== null) {
        embedded.set(url, uri);
      }
    }),
  );

  return {
    html: noteToHtml(content, (url) => embedded.get(url) ?? null),
    text: noteToText(content),
    images: names,
  };
}
