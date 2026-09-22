import { Fragment, useCallback, type ReactNode } from "react";
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
}: {
  value: string;
  head: boolean;
  align: Table["align"][number];
  label: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  return (
    <input
      className={head ? styles.head : styles.cell}
      style={{ textAlign: align ?? undefined }}
      value={value}
      aria-label={label}
      spellCheck
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

  const removeRow = (index: number) => {
    write({ ...table, rows: table.rows.filter((_, at) => at !== index) });
  };

  const columns = table.header.length;

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
        {/* One grid, so every button lines up with the row or column it acts
            on without anything having to be measured. The gutter is the last
            column and the strips are the first and last rows. */}
        <div
          className={styles.grid}
          style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(64px, 1fr)) 22px` }}
        >
          {table.header.map((_, column) => (
            <button
              key={`x${String(column)}`}
              type="button"
              className={styles.edge}
              aria-label={`Remove column ${String(column + 1)}`}
              title="Remove this column"
              disabled={columns <= 1}
              onClick={() => {
                removeColumn(column);
              }}
            >
              <Minus size={12} strokeWidth={2} />
            </button>
          ))}
          <button
            type="button"
            className={styles.edge}
            aria-label="Add column"
            title="Add a column"
            onClick={addColumn}
          >
            <Plus size={12} strokeWidth={2} />
          </button>

          {table.header.map((cell, column) => (
            <Cell
              key={`h${String(column)}`}
              value={cell}
              head
              align={table.align[column] ?? null}
              label={`Column ${String(column + 1)} heading`}
              onChange={(value) => {
                setCell(-1, column, value);
              }}
              onEnter={addRow}
            />
          ))}
          <span className={styles.corner} />

          {table.rows.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              {row.map((cell, column) => (
                <Cell
                  key={column}
                  value={cell}
                  head={false}
                  align={table.align[column] ?? null}
                  label={`Row ${String(rowIndex + 1)}, column ${String(column + 1)}`}
                  onChange={(value) => {
                    setCell(rowIndex, column, value);
                  }}
                  onEnter={addRow}
                />
              ))}
              <button
                type="button"
                className={styles.edge}
                aria-label={`Remove row ${String(rowIndex + 1)}`}
                title="Remove this row"
                onClick={() => {
                  removeRow(rowIndex);
                }}
              >
                <Minus size={12} strokeWidth={2} />
              </button>
            </Fragment>
          ))}

          {/* Sticky to the left, so the way to add a row is still on screen
              when a wide table has been scrolled sideways. */}
          <button
            type="button"
            className={styles.addRow}
            style={{ gridColumn: `1 / -1` }}
            aria-label="Add row"
            title="Add a row"
            onClick={addRow}
          >
            <Plus size={12} strokeWidth={2} />
            Row
          </button>
        </div>
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
