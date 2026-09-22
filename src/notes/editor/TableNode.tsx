import { useCallback, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  DecoratorNode,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { emptyTable, formatTable, type Table } from "../../lib/table";
import styles from "./TableNode.module.css";

export type SerializedTableNode = Spread<{ table: Table }, SerializedLexicalNode>;

/** Keeps an editing event inside the table; see the wrapper below. */
function stopEditingEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

/** A cell is a line; the grid is the structure. Enter moves on rather than wrapping. */
function Cell({
  value,
  head,
  align,
  label,
  onChange,
  onEnter,
  onFocus,
}: {
  value: string;
  head: boolean;
  align: Table["align"][number];
  label: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  onFocus: () => void;
}) {
  return (
    <input
      className={head ? styles.head : styles.cell}
      style={{ textAlign: align ?? undefined }}
      value={value}
      aria-label={label}
      spellCheck
      onFocus={onFocus}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

/**
 * A table you can type into.
 *
 * The same shape as the code block (0.4.0): a `DecoratorNode` holding real form
 * controls rather than rich text. A cell is a single line of plain text, which
 * is exactly what a pipe table can store — a cell that could hold a paragraph,
 * or another list, would be a cell the dialect cannot write back.
 *
 * Every edit writes the whole table onto the node, so `getTextContent` — and
 * through it the serialiser — has one thing to read.
 */
function TableGrid({ nodeKey, table }: { nodeKey: NodeKey; table: Table }) {
  const [editor] = useLexicalComposerContext();
  // Which cell the caret is in, so "Remove row" has something to mean. The
  // controls are all in the footer rather than one per row: a button in the
  // grid's last column is off the right-hand edge of a 320 px panel as soon as
  // the table is wide enough to scroll, and a control that can be clipped is a
  // control that is not there (see the image handle, 0.7.0).
  const [at, setAt] = useState<{ row: number; column: number }>({ row: -1, column: 0 });

  const write = useCallback(
    (next: Table) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isTableNode(node)) {
          node.setTable(next);
        }
      });
    },
    [editor, nodeKey],
  );

  const setCell = (row: number, column: number, value: string) => {
    if (row === -1) {
      const header = [...table.header];
      header[column] = value;
      write({ ...table, header });
      return;
    }
    const rows = table.rows.map((cells, index) =>
      index === row ? cells.map((cell, at) => (at === column ? value : cell)) : cells,
    );
    write({ ...table, rows });
  };

  const addRow = () => {
    write({
      ...table,
      rows: [...table.rows, table.header.map(() => "")],
    });
  };

  const addColumn = () => {
    write({
      header: [...table.header, ""],
      rows: table.rows.map((row) => [...row, ""]),
      align: [...table.align, null],
    });
  };

  const removeColumn = (index: number) => {
    if (table.header.length <= 1) {
      return;
    }
    write({
      header: table.header.filter((_, at) => at !== index),
      rows: table.rows.map((row) => row.filter((_, at) => at !== index)),
      align: table.align.filter((_, at) => at !== index),
    });
  };

  const removeFocusedRow = () => {
    const index = at.row === -1 ? table.rows.length - 1 : at.row;
    if (index < 0) {
      return;
    }
    write({ ...table, rows: table.rows.filter((_, i) => i !== index) });
    setAt((held) => ({ ...held, row: -1 }));
  };

  const removeFocusedColumn = () => {
    removeColumn(Math.min(at.column, table.header.length - 1));
    setAt((held) => ({ ...held, column: 0 }));
  };

  return (
    <div
      className={styles.wrap}
      // The grid is inside the editor's root, so every keystroke in a cell
      // bubbles to the listeners Lexical has there — and a character it tries
      // to reconcile into a decorator that holds no text is a character that
      // never reaches the field. The same wrapper the code block needs, for the
      // same reason, and with the same exception: Escape belongs to the panel's
      // own cascade, whose listener is on the window.
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          event.stopPropagation();
        }
      }}
      onKeyUp={stopEditingEvent}
      onBeforeInput={stopEditingEvent}
      onInput={stopEditingEvent}
      onPaste={stopEditingEvent}
      onCut={stopEditingEvent}
      onCopy={stopEditingEvent}
      onCompositionStart={stopEditingEvent}
      onCompositionEnd={stopEditingEvent}
    >
      <div className={styles.scroller}>
        <div
          className={styles.grid}
          style={{
            gridTemplateColumns: `repeat(${String(table.header.length)}, minmax(64px, 1fr))`,
          }}
        >
          {table.header.map((cell, column) => (
            <Cell
              key={`h${String(column)}`}
              value={cell}
              head
              align={table.align[column] ?? null}
              label={`Column ${String(column + 1)} heading`}
              onFocus={() => {
                setAt({ row: -1, column });
              }}
              onChange={(value) => {
                setCell(-1, column, value);
              }}
              onEnter={addRow}
            />
          ))}
          {table.rows.map((row, rowIndex) =>
            row.map((cell, column) => (
              <Cell
                key={`${String(rowIndex)}:${String(column)}`}
                value={cell}
                head={false}
                align={table.align[column] ?? null}
                label={`Row ${String(rowIndex + 1)}, column ${String(column + 1)}`}
                onFocus={() => {
                  setAt({ row: rowIndex, column });
                }}
                onChange={(value) => {
                  setCell(rowIndex, column, value);
                }}
                onEnter={addRow}
              />
            )),
          )}
        </div>
      </div>
      <div className={styles.foot}>
        <button type="button" className={styles.footTool} onClick={addRow}>
          <Plus size={12} strokeWidth={2} />
          Row
        </button>
        <button type="button" className={styles.footTool} onClick={addColumn}>
          <Plus size={12} strokeWidth={2} />
          Column
        </button>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.footTool}
          onClick={removeFocusedRow}
          disabled={table.rows.length === 0}
          title="Remove the row the caret is in"
        >
          <Minus size={12} strokeWidth={2} />
          Row
        </button>
        <button
          type="button"
          className={styles.footTool}
          onClick={removeFocusedColumn}
          disabled={table.header.length <= 1}
          title="Remove the column the caret is in"
        >
          <Minus size={12} strokeWidth={2} />
          Column
        </button>
      </div>
    </div>
  );
}

export class TableNode extends DecoratorNode<ReactNode> {
  __table: Table;

  static getType(): string {
    return "ledge-table";
  }

  static clone(node: TableNode): TableNode {
    return new TableNode(node.__table, node.__key);
  }

  constructor(table: Table = emptyTable(), key?: NodeKey) {
    super(key);
    this.__table = table;
  }

  static importJSON(serialized: SerializedTableNode): TableNode {
    return new TableNode(serialized.table);
  }

  exportJSON(): SerializedTableNode {
    return { ...super.exportJSON(), table: this.__table };
  }

  /** Copying a note out of the app carries the table as the text it is. */
  exportDOM(): DOMExportOutput {
    const pre = document.createElement("pre");
    pre.textContent = this.getTextContent();
    return { element: pre };
  }

  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  updateDOM(): false {
    return false;
  }

  getTable(): Table {
    return this.getLatest().__table;
  }

  setTable(table: Table): void {
    this.getWritable().__table = table;
  }

  /** The note's own Markdown for it, which is what the serialiser writes. */
  getTextContent(): string {
    return formatTable(this.getLatest().__table);
  }

  isInline(): false {
    return false;
  }

  decorate(): ReactNode {
    return <TableGrid nodeKey={this.getKey()} table={this.__table} />;
  }
}

export function $createTableNode(table: Table = emptyTable()): TableNode {
  return new TableNode(table);
}

export function $isTableNode(node: LexicalNode | null | undefined): node is TableNode {
  return node instanceof TableNode;
}
