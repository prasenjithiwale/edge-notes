import { useRef, useState, type DragEvent } from "react";

import type { Note } from "../lib/ipc";
import { cx } from "../lib/cx";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import styles from "./NoteList.module.css";

interface NoteListProps {
  notes: Note[];
  editingId: string | null;
  onOpen: (id: string) => void;
  onUnpin: (id: string) => void;
  onExpand: (id: string) => void;
  onToggleTask: (id: string, line: number) => void;
  /**
   * Take the list in this new order (idea 16). Omitted when the list on screen
   * is not the whole list — a drop inside a filtered or searched list would
   * write an order for the notes it can see and silently decide where the rest
   * went.
   */
  onReorder?: ((ids: string[]) => void) | undefined;
}

/**
 * Where a dropped card would land: above or below the card under the cursor,
 * which is the one thing a drop needs to show before it happens.
 */
type Drop = { id: string; after: boolean } | null;

export function NoteList({
  notes,
  editingId,
  onOpen,
  onUnpin,
  onExpand,
  onToggleTask,
  onReorder,
}: NoteListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  // The id being dragged, readable from a handler that fires before React has
  // re-rendered with it. `dataTransfer` would do, but Safari only fills it in on
  // drop, and the line has to be drawn while the cursor is still moving.
  const dragging = useRef<string | null>(null);

  const canDrag = onReorder !== undefined;

  const end = () => {
    dragging.current = null;
    setDragId(null);
    setDrop(null);
  };

  const over = (event: DragEvent, id: string) => {
    const held = dragging.current;
    if (held === null || held === id) {
      return;
    }
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    setDrop({ id, after: event.clientY > box.top + box.height / 2 });
  };

  const release = () => {
    const held = dragging.current;
    if (held === null || drop === null || onReorder === undefined) {
      end();
      return;
    }
    const ids = notes.map((note) => note.id);
    const without = ids.filter((id) => id !== held);
    const at = without.indexOf(drop.id);
    if (at !== -1) {
      without.splice(drop.after ? at + 1 : at, 0, held);
      onReorder(without);
    }
    end();
  };

  return (
    <div className={styles.list}>
      {notes.map((note) =>
        note.id === editingId ? (
          // The card expands in place into the editor (brief 6.9).
          <NoteEditor key={note.id} note={note} />
        ) : (
          <div
            key={note.id}
            // The keyboard's move (⌥↑/⌥↓) needs to know which note it is on,
            // and the focused element is somewhere inside the card.
            data-note-id={note.id}
            className={cx(
              styles.slot,
              dragId === note.id && styles.dragging,
              drop?.id === note.id && (drop.after ? styles.dropAfter : styles.dropBefore),
            )}
            // The slot is not draggable itself: inside a draggable element
            // WebKit turns every press-and-drag into a drag, so a locked card's
            // text could not be selected. The card's grip is what is dragged,
            // and its dragstart bubbles here.
            onDragStart={(event) => {
              dragging.current = note.id;
              setDragId(note.id);
              // Some text has to be set or WebKit refuses to start the drag; it
              // never leaves the panel, so what it says does not matter.
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", note.id);
              // The whole card is what is being moved, not the grip under the
              // pointer, so the picture that follows the cursor is the card,
              // held at the point it was picked up by.
              const box = event.currentTarget.getBoundingClientRect();
              event.dataTransfer.setDragImage(
                event.currentTarget,
                event.clientX - box.left,
                event.clientY - box.top,
              );
            }}
            onDragOver={(event) => {
              over(event, note.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              release();
            }}
            onDragEnd={end}
          >
            <NoteCard
              note={note}
              movable={canDrag}
              onOpen={() => {
                onOpen(note.id);
              }}
              onUnpin={() => {
                onUnpin(note.id);
              }}
              onExpand={() => {
                onExpand(note.id);
              }}
              onToggleTask={(line) => {
                onToggleTask(note.id, line);
              }}
            />
          </div>
        ),
      )}
    </div>
  );
}
