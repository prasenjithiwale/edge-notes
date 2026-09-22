/**
 * `#tags` in note text (idea 16). Pure: no IPC, no React.
 *
 * A tag is plain text and stays plain text — it is parsed out of the note on the
 * way to the screen and never stored anywhere else, so export, sync and the
 * editor's round trip are untouched. That is also why there is no tags table: a
 * tag is something the note says, not something the app keeps about it.
 */
import type { Note } from "./ipc";

/**
 * `#` immediately followed by a letter or digit, at the start of a line or after
 * a space or an opening bracket.
 *
 * The three things it must not match are what decide the shape: `# heading` (the
 * dialect's heading needs the space, so requiring a letter next rules it out),
 * `https://example.com/#anchor` (the `#` there follows a word character), and
 * `#` on its own. Letters are Unicode, because a tag in Hindi or Japanese is a
 * tag.
 */
const TAG = /(?<=^|[\s([{>])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;

/** Fenced blocks and inline code: `#!/bin/sh` is not a tag. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/**
 * Every tag in one note, in the order written, without repeats.
 *
 * Case is not part of a tag — `#Work` and `#work` are one tag — and the first
 * spelling written is the one shown, because that is the one someone chose.
 */
export function extractTags(content: string): string[] {
  const prose = content.replace(CODE, " ");
  const seen = new Map<string, string>();
  for (const match of prose.matchAll(TAG)) {
    const tag = match[1] ?? "";
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, tag);
    }
  }
  return [...seen.values()];
}

/**
 * A run of plain text broken into the words around its tags, so the reader can
 * draw a tag as a tag. One string means there was nothing to find.
 */
export function splitTags(text: string): (string | { tag: string })[] {
  const parts: (string | { tag: string })[] = [];
  let at = 0;
  for (const match of text.matchAll(TAG)) {
    const start = match.index;
    if (start > at) {
      parts.push(text.slice(at, start));
    }
    parts.push({ tag: match[1] ?? "" });
    at = start + match[0].length;
  }
  if (parts.length === 0) {
    return [text];
  }
  if (at < text.length) {
    parts.push(text.slice(at));
  }
  return parts;
}

/** Whether a note carries `tag`, compared the way tags are compared. */
export function hasTag(note: Note, tag: string): boolean {
  const wanted = tag.toLowerCase();
  return extractTags(note.content).some((found) => found.toLowerCase() === wanted);
}

/**
 * The tags offered in the filter row: most used first, then alphabetically, so
 * the row is stable as notes are edited and the tags worth reaching for are the
 * ones nearest the left.
 *
 * `selected` is kept even when nothing matches it any more, for the same reason
 * the colour row keeps its selected dot: otherwise clearing the filter would
 * mean finding the chip that had just been taken off the row.
 */
export function facetTags(notes: Note[], selected: string | null = null): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const note of notes) {
    for (const tag of extractTags(note.content)) {
      const key = tag.toLowerCase();
      const entry = counts.get(key);
      if (entry === undefined) {
        counts.set(key, { label: tag, count: 1 });
      } else {
        entry.count += 1;
      }
    }
  }
  if (selected !== null && !counts.has(selected.toLowerCase())) {
    counts.set(selected.toLowerCase(), { label: selected, count: 0 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => entry.label);
}
