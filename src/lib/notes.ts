/**
 * Pure note logic: sorting, filtering and labels. No IPC, no React — brief 11
 * calls these out for unit testing. What a card shows (title, preview, list
 * rows) is derived with the formatting in `markdown.ts`.
 */
import type { Note } from "./ipc";
import { hasTag } from "./tags";

/** A note with nothing but whitespace is discarded when the editor closes. */
export function isNoteEmpty(content: string): boolean {
  return content.trim().length === 0;
}

/**
 * Pinned first, then most recently edited (brief 6.8), with the id as a tiebreak
 * so two notes saved in the same millisecond keep a stable order instead of
 * flickering. Mirrors the ORDER BY in the notes repository — the list is sorted
 * in both places, and they must agree or a reload would reshuffle the panel.
 *
 * With `manual`, the order is the one the cards were dragged into (idea 16): a
 * note with no `sortOrder` has never been dragged and sorts to the top, which is
 * where a note written since the last arrangement was made.
 */
export function sortNotes(notes: Note[], manual = false): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (manual) {
      const byOrder = (a.sortOrder ?? -Infinity) - (b.sortOrder ?? -Infinity);
      if (byOrder !== 0) {
        return byOrder;
      }
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
  /** A `#tag` the note must carry, without the hash, or null for all tags. */
  tag?: string | null;
  /** Free text; matched case-insensitively against the whole note. */
  query?: string;
}

export function filterNotes(notes: Note[], filter: NoteFilter): Note[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const color = filter.color ?? null;
  const tag = filter.tag ?? null;

  return notes.filter((note) => {
    if (color !== null && note.color !== color) {
      return false;
    }
    if (query.length > 0 && !note.content.toLowerCase().includes(query)) {
      return false;
    }
    if (tag !== null && !hasTag(note, tag)) {
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

/** How many swatches the editor shows before the full palette is opened. */
export const QUICK_COLOR_COUNT = 7;

/**
 * The editor's quick swatches: the note's own colour, then the colours of the
 * most recently edited notes, topped up from `defaults` (brief 7.3's original
 * seven), shown in palette order so they do not reshuffle as recency changes.
 */
export function quickColors<T extends string>(
  current: T,
  notes: Note[],
  palette: readonly T[],
  defaults: readonly T[],
  count = QUICK_COLOR_COUNT,
): T[] {
  const picked = new Set<string>([current]);
  for (const note of [...notes].sort(byRecentEdit)) {
    if (picked.size >= count) {
      break;
    }
    picked.add(note.color);
  }
  for (const color of defaults) {
    if (picked.size >= count) {
      break;
    }
    picked.add(color);
  }
  return palette.filter((color) => picked.has(color));
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

  // A full minute, not 45 seconds: the next branch floors to whole minutes, so
  // the fifteen seconds in between used to read "Edited 0m ago".
  if (age < MINUTE_MS) {
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
  // The absence of a colour is not called "None" the way a colour is called
  // "Mint": what the button does is take the colour off.
  if (color === "none") {
    return "No colour";
  }
  return color.slice(0, 1).toUpperCase() + color.slice(1);
}
