/**
 * Pure note logic: sorting, filtering and labels. No IPC, no React — brief 11
 * calls these out for unit testing. What a card shows (title, preview, list
 * rows) is derived with the formatting in `markdown.ts`.
 */
import type { Note } from "./ipc";

/** A note with nothing but whitespace is discarded when the editor closes. */
export function isNoteEmpty(content: string): boolean {
  return content.trim().length === 0;
}

/**
 * Pinned first, then most recently edited (brief 6.8), with the id as a tiebreak
 * so two notes saved in the same millisecond keep a stable order instead of
 * flickering. Mirrors the ORDER BY in the notes repository — the list is sorted
 * in both places, and they must agree or a reload would reshuffle the panel.
 */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return byRecentEdit(a, b);
  });
}

function byRecentEdit(a: Note, b: Note): number {
  if (a.updatedAt !== b.updatedAt) {
    return b.updatedAt - a.updatedAt;
  }
  return b.id.localeCompare(a.id);
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
 * The colours shown in the filter row: palette order, only colours that some
 * note actually uses (brief 6.7).
 *
 * `selected` is always kept, even if nothing matches it any more. Without that,
 * deleting the last note of the selected colour would take its dot — and so the
 * only way to clear the filter by clicking it — off the row.
 */
export function facetColors<T extends string>(
  notes: Note[],
  palette: readonly T[],
  selected: T | null = null,
): T[] {
  const present = new Set<string>(notes.map((note) => note.color));
  return palette.filter((color) => present.has(color) || color === selected);
}

/**
 * Colours of the three most recently edited notes, for the dots on the tab
 * (brief 6.5). Sorted here rather than trusting the caller, because the store
 * deliberately leaves the list unsorted while the editor is open — and by edit
 * time alone, not `sortNotes`: pinning decides the list order, but the tab
 * promises the most recently *edited* notes.
 */
export function recentColors(notes: Note[], limit = 3): string[] {
  return [...notes]
    .sort(byRecentEdit)
    .slice(0, limit)
    .map((note) => note.color);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Calendar months vary; the editor footer is a rough hint, not a timestamp. */
const MONTH_MS = 30 * DAY_MS;

/**
 * The editor footer's "Edited 2h ago" (brief 6.9). Coarse on purpose, and
 * self-contained rather than locale-formatted so it reads the same everywhere
 * and stays deterministic under test. A future `updatedAt` (clock skew between
 * devices, once sync exists) reads as "just now" rather than as a negative age.
 */
export function editedLabel(updatedAt: number, now: number): string {
  const age = Math.max(0, now - updatedAt);

  if (age < 45 * 1_000) {
    return "Edited just now";
  }
  if (age < HOUR_MS) {
    return `Edited ${String(Math.floor(age / MINUTE_MS))}m ago`;
  }
  if (age < DAY_MS) {
    return `Edited ${String(Math.floor(age / HOUR_MS))}h ago`;
  }
  if (age < MONTH_MS) {
    return `Edited ${String(Math.floor(age / DAY_MS))}d ago`;
  }
  return `Edited ${String(Math.floor(age / MONTH_MS))}mo ago`;
}

/**
 * A palette id as a label for a swatch or filter dot: sentence case, like every
 * other string in the UI (brief 7.1).
 */
export function colorName(color: string): string {
  return color.slice(0, 1).toUpperCase() + color.slice(1);
}
