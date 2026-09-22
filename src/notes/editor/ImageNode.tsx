import { useCallback, useRef, useState, type ReactNode } from "react";
import type React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  DecoratorNode,
  type LexicalEditor,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { IMAGE_PREFIX, imageSrc } from "../../lib/images";
import styles from "./RichEditor.module.css";

export type SerializedImageNode = Spread<
  { url: string; alt: string; width: number | null },
  SerializedLexicalNode
>;

/** Narrower than this is not a picture any more; the editable's width is the cap. */
export const MIN_IMAGE_WIDTH = 48;

/**
 * A picture in the editor (idea 17).
 *
 * Inline rather than a block of its own, so pasting into the middle of a
 * sentence puts it where the caret was and Backspace beside it removes it, the
 * way every other inline thing behaves. There is no toolbar on it: the one
 * action a picture needs is to be deleted, and the key that deletes things
 * already does it.
 *
 * `getTextContent` returns the note's own Markdown for it, which is what makes
 * the serialiser need no case of its own — `runLines` already writes an unknown
 * child's text content, and for this node that text *is* `![alt](url)`.
 */
/**
 * The picture, with a corner to pull.
 *
 * The width is kept in React state while the pointer is down and written to the
 * node once, on release: an `editor.update` per pointermove would put a hundred
 * entries in the undo history for one drag, and every one of them would save the
 * note.
 *
 * The handle is always drawn, not drawn on hover. An inactive window on macOS
 * may never see a hover at all (brief 7.5), and a control nobody can find is a
 * feature nobody has.
 */
function ResizableImage({
  nodeKey,
  src,
  alt,
  width,
}: {
  nodeKey: NodeKey;
  src: string;
  alt: string;
  width: number | null;
}) {
  const [editor] = useLexicalComposerContext();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  /** As wide as the line it sits on: the editable's own content width. */
  const maxWidth = useCallback(() => {
    const parent = wrapRef.current?.closest<HTMLElement>("[contenteditable]");
    return Math.max(MIN_IMAGE_WIDTH, parent?.clientWidth ?? 320);
  }, []);

  const commit = useCallback(
    (next: number | null) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) {
          node.setWidth(next);
        }
      });
    },
    [editor, nodeKey],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    // The caret must not move to the picture, and the editor must not start a
    // selection: this press is about the handle only.
    event.preventDefault();
    event.stopPropagation();
    const start = wrapRef.current?.getBoundingClientRect().width ?? MIN_IMAGE_WIDTH;
    const startX = event.clientX;
    const cap = maxWidth();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const move = (moved: PointerEvent) => {
      setDragging(
        Math.round(Math.min(cap, Math.max(MIN_IMAGE_WIDTH, start + moved.clientX - startX))),
      );
    };
    const up = (ended: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      const final = Math.round(
        Math.min(cap, Math.max(MIN_IMAGE_WIDTH, start + ended.clientX - startX)),
      );
      setDragging(null);
      // A drag that ends where it started is a click, and a click on the handle
      // is how a picture goes back to its natural size.
      commit(Math.abs(final - start) < 3 ? null : final);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const nudge = (by: number) => {
    const cap = maxWidth();
    const from = wrapRef.current?.getBoundingClientRect().width ?? MIN_IMAGE_WIDTH;
    commit(Math.round(Math.min(cap, Math.max(MIN_IMAGE_WIDTH, from + by))));
  };

  const shown = dragging ?? width;

  return (
    <span
      ref={wrapRef}
      className={styles.imageWrap}
      style={shown === null ? undefined : { width: `${String(shown)}px` }}
    >
      <img className={styles.image} src={src} alt={alt} draggable={false} />
      <button
        type="button"
        className={styles.imageHandle}
        aria-label="Resize image"
        title="Drag to resize, click to reset"
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          // The same control from the keyboard, because a picture that can only
          // be resized with a pointer cannot be resized by everyone.
          const step = event.shiftKey ? 48 : 16;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            nudge(step);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudge(-step);
          } else if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            commit(null);
          }
        }}
      />
    </span>
  );
}

export class ImageNode extends DecoratorNode<ReactNode> {
  __url: string;
  __alt: string;
  /** Logical pixels, or null for "as big as it comes". */
  __width: number | null;

  static getType(): string {
    return "ledge-image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__url, node.__alt, node.__width, node.__key);
  }

  constructor(url: string, alt = "", width: number | null = null, key?: NodeKey) {
    super(key);
    this.__url = url;
    this.__alt = alt;
    this.__width = width;
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    return new ImageNode(serialized.url, serialized.alt, serialized.width);
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      url: this.__url,
      alt: this.__alt,
      width: this.__width,
    };
  }

  getWidth(): number | null {
    return this.getLatest().__width;
  }

  setWidth(width: number | null): void {
    this.getWritable().__width = width;
  }

  /** Copying a note out of the app carries the link, not the bytes. */
  exportDOM(): DOMExportOutput {
    const image = document.createElement("img");
    image.setAttribute("src", this.__url);
    image.setAttribute("alt", this.__alt);
    return { element: image };
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
  }

  getUrl(): string {
    return this.getLatest().__url;
  }

  getTextContent(): string {
    return imageMarkdownOf(this.__alt, this.__url, this.__width);
  }

  isInline(): true {
    return true;
  }

  decorate(): ReactNode {
    const src = imageSrc(this.__url);
    if (src === null) {
      return <span>{this.getTextContent()}</span>;
    }
    return (
      <ResizableImage
        nodeKey={this.getKey()}
        src={src}
        alt={this.__alt}
        width={this.__width}
      />
    );
  }
}

/**
 * `![alt|320](url)`, the one addition this dialect makes to the image syntax.
 * Written here rather than in `lib/images.ts` because it is the *node's* text
 * content — the serialiser writes whatever this returns.
 */
export function imageMarkdownOf(
  alt: string,
  url: string,
  width: number | null,
): string {
  const label = width === null ? alt : `${alt}|${String(Math.round(width))}`;
  return `![${label}](${url})`;
}

/**
 * Put a stored image into the note, at the caret if there is one and at the end
 * if there is not. Both ways in — pasting and the picker — end here, so there is
 * one answer to where a picture goes.
 */
export function insertImage(editor: LexicalEditor, name: string): void {
  editor.update(() => {
    const image = $createImageNode(`${IMAGE_PREFIX}${name}`);
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      selection.insertNodes([image]);
      return;
    }
    $getRoot().append($createParagraphNode().append(image));
  });
}

export function $createImageNode(
  url: string,
  alt = "",
  width: number | null = null,
): ImageNode {
  return new ImageNode(url, alt, width);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
