/**
 * A note as HTML, for sharing it with an app that is not this one (idea 14's
 * neighbours: Apple Notes, OneNote, Mail, Word).
 *
 * Markdown is what a note *is*, and Markdown is what the Markdown apps want —
 * but Apple Notes and OneNote do not read it at all. What they do read, and
 * what every one of them pastes correctly, is HTML on the clipboard. So this is
 * a second rendering of the same parse: `lib/markdown.ts` is still the only
 * thing that decides what a note says, and this decides how to say it in HTML.
 *
 * Pure, and deliberately plain: no classes, no stylesheet, inline styles only
 * where a receiving app would otherwise lose the meaning. A note pasted into
 * Notes should look like the note, not like a web page.
 */
import { parseBlocks, parseInline, type Inline } from "./markdown";

/** How an image's `src` is resolved; null drops the picture (see `shareNote`). */
export type ImageSrc = (url: string) => string | null;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(nodes: Inline[], src: ImageSrc): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return escapeHtml(node.text);
        case "bold":
          return `<strong>${inlineHtml(node.children, src)}</strong>`;
        case "italic":
          return `<em>${inlineHtml(node.children, src)}</em>`;
        case "strike":
          return `<s>${inlineHtml(node.children, src)}</s>`;
        case "code":
          return `<code>${escapeHtml(node.text)}</code>`;
        case "link": {
          const url = escapeHtml(node.url);
          return `<a href="${url}">${url}</a>`;
        }
        case "image": {
          const resolved = src(node.url);
          if (resolved === null) {
            // Nothing is invented: a picture that cannot travel says so, rather
            // than arriving as a broken image icon in someone's note.
            return node.alt === "" ? "[image]" : `[${escapeHtml(node.alt)}]`;
          }
          const width = node.width === null ? "" : ` width="${String(node.width)}"`;
          return `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(node.alt)}"${width}>`;
        }
      }
    })
    .join("");
}

/** A `<ul>`/`<ol>` being built, so consecutive items of a kind become one list. */
interface OpenList {
  tag: "ul" | "ol";
  items: string[];
}

function closeList(list: OpenList | null, out: string[]): null {
  if (list !== null) {
    out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
  }
  return null;
}

/**
 * The note, as a fragment of HTML.
 *
 * Checklists become a `<ul>` with ☐ and ☑ in the text rather than
 * `<input type="checkbox">`: a checkbox pasted into Notes arrives disabled or
 * not at all, and a box someone can see and tick by hand beats one that is
 * there and dead.
 */
export function noteToHtml(content: string, src: ImageSrc): string {
  const out: string[] = [];
  let list: OpenList | null = null;

  for (const block of parseBlocks(content)) {
    if (block.kind === "code") {
      list = closeList(list, out);
      out.push(`<pre><code>${escapeHtml(block.code)}</code></pre>`);
      continue;
    }

    if (block.kind === "table") {
      list = closeList(list, out);
      const cells = (row: string[], tag: "th" | "td") =>
        row
          .map((cell, index) => {
            const align = block.table.align[index];
            const style = align === null || align === undefined ? "" : ` style="text-align:${align}"`;
            return `<${tag}${style}>${inlineHtml(parseInline(cell), src)}</${tag}>`;
          })
          .join("");
      out.push(
        `<table><thead><tr>${cells(block.table.header, "th")}</tr></thead><tbody>${block.table.rows
          .map((row) => `<tr>${cells(row, "td")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }

    const { line } = block;
    const html = inlineHtml(parseInline(line.text), src);

    if (line.kind === "bullet" || line.kind === "task") {
      const tick = line.kind === "task" ? (line.checked ? "☑ " : "☐ ") : "";
      if (list === null || list.tag !== "ul") {
        closeList(list, out);
        list = { tag: "ul", items: [] };
      }
      list.items.push(`<li>${tick}${html}</li>`);
      continue;
    }
    if (line.kind === "ordered") {
      if (list === null || list.tag !== "ol") {
        closeList(list, out);
        list = { tag: "ol", items: [] };
      }
      list.items.push(`<li>${html}</li>`);
      continue;
    }

    list = closeList(list, out);
    if (line.kind === "heading") {
      out.push(`<h${String(line.level)}>${html}</h${String(line.level)}>`);
      continue;
    }
    if (line.text.trim() === "") {
      continue;
    }
    out.push(`<p>${html}</p>`);
  }

  closeList(list, out);
  return out.join("\n");
}

/**
 * The plain-text half of a share: the note as it is stored, minus the things
 * that only mean something inside this app.
 *
 * An image link is the one of those: `ledge://localhost/…` is a path into an
 * app data folder nobody else has, and pasting it into a message would be
 * pasting a dead link.
 */
export function noteToText(content: string): string {
  return content
    .split("\n")
    .map((line) =>
      line.replace(/!\[([^\]]*)\]\(ledge:\/\/[^\s)]*\)/g, (_, alt: string) =>
        alt === "" ? "[image]" : `[${alt.replace(/\|\d+$/, "")}]`,
      ),
    )
    .join("\n");
}
