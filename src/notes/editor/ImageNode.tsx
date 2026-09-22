import type { ReactNode } from "react";
import {
  DecoratorNode,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

import { imageSrc } from "../../lib/images";
import styles from "./RichEditor.module.css";

export type SerializedImageNode = Spread<
  { url: string; alt: string },
  SerializedLexicalNode
>;

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
export class ImageNode extends DecoratorNode<ReactNode> {
  __url: string;
  __alt: string;

  static getType(): string {
    return "ledge-image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__url, node.__alt, node.__key);
  }

  constructor(url: string, alt = "", key?: NodeKey) {
    super(key);
    this.__url = url;
    this.__alt = alt;
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    return new ImageNode(serialized.url, serialized.alt);
  }

  exportJSON(): SerializedImageNode {
    return { ...super.exportJSON(), url: this.__url, alt: this.__alt };
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
    return `![${this.__alt}](${this.__url})`;
  }

  isInline(): true {
    return true;
  }

  decorate(): ReactNode {
    const src = imageSrc(this.__url);
    if (src === null) {
      return <span>{this.getTextContent()}</span>;
    }
    return <img className={styles.image} src={src} alt={this.__alt} draggable={false} />;
  }
}

export function $createImageNode(url: string, alt = ""): ImageNode {
  return new ImageNode(url, alt);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
  return node instanceof ImageNode;
}
