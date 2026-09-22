import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  // What Tauri does on macOS and Linux; on Windows it returns an
  // http://ledge.localhost URL instead, which is the whole reason it is used.
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));

const { IMAGE_PREFIX, imageMarkdown, imageSrc } = await import("./images");

const NAME = "0199a000-0000-7000-8000-000000000001.png";

/**
 * The note text is the user's, and this is what decides whether something in it
 * becomes a request. Anything that is not a name this app wrote gets no `src` at
 * all — a remote URL in a note must not become a fetch made on their behalf, and
 * a name that could climb out of the images folder must never reach the handler.
 */
describe("an image's src", () => {
  it("is built for the platform from one of our own names", () => {
    expect(imageSrc(`${IMAGE_PREFIX}${NAME}`)).toBe(`ledge://localhost/${NAME}`);
  });

  it("is nothing at all for anything else", () => {
    expect(imageSrc("https://example.com/cat.png")).toBeNull();
    expect(imageSrc(`${IMAGE_PREFIX}../notes.db`)).toBeNull();
    expect(imageSrc(`${IMAGE_PREFIX}notes.db`)).toBeNull();
    expect(imageSrc(`${IMAGE_PREFIX}${NAME}/../../secret`)).toBeNull();
    expect(imageSrc(`${IMAGE_PREFIX}0199a000-0000-7000-8000-000000000001.exe`)).toBeNull();
    expect(imageSrc("")).toBeNull();
  });

  it("writes the markdown a note stores", () => {
    expect(imageMarkdown(NAME)).toBe(`![](${IMAGE_PREFIX}${NAME})`);
    expect(imageMarkdown(NAME, "the graph")).toBe(`![the graph](${IMAGE_PREFIX}${NAME})`);
  });
});
