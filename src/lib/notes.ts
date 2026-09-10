/**
 * Pure note logic: title and preview derivation, sorting and filtering.
 * No IPC, no React — brief 11 calls these out for unit testing.
 */
import type { Note } from "./ipc";

/**
 * The title is the first non-empty line; there is no separate title field
 * (brief 6.8). Leading blank lines are skipped rather than yielding an empty
 * title above visible text.
 */
export function noteTitle(content: string): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

/**
 * Everything after the title line, collapsed to a single string. The card
 * clamps it to two lines in CSS, so newlines become spaces here.
 */
export function notePreview(content: string): string {
  const lines = content.split("\n");
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex === -1) {
    return "";
  }
  return lines
    .slice(titleIndex + 1)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A note with nothing but whitespace is discarded when the editor closes. */
export function isNoteEmpty(content: string): boolean {
  return content.trim().length === 0;
}

/**
 * Most recently edited first (brief 6.8), with the id as a tiebreak so two notes
 * saved in the same millisecond keep a stable order instead of flickering.
 */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    return b.id.localeCompare(a.id);
  });
}

export interface NoteFilter {
  /** Palette id, or null for "All". */
  color?: string | null;
  /** Free text; matched case-insensitively against the whole note. */
  query?: string;
}

export function filterNotes(notes: Note[], filter: NoteFilter): Note[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const color = filter.color ?? null;

  return notes.filter((note) => {
    if (color !== null && note.color !== color) {
      return false;
    }
    if (query.length > 0 && !note.content.toLowerCase().includes(query)) {
      return false;
    }
    return true;
  });
}

/**
 * Palette ids that have at least one note, in palette order. The filter row
 * hides colours with no notes (brief 6.7).
 */
export function usedColors<T extends string>(
  notes: Note[],
  palette: readonly T[],
): T[] {
  const present = new Set<string>(notes.map((note) => note.color));
  return palette.filter((color) => present.has(color));
}
