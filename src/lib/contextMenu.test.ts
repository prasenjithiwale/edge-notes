// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { suppressContextMenu } from "./contextMenu";

function rightClick(target: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("suppressContextMenu", () => {
  it("prevents the menu everywhere, text fields and selected text included", () => {
    const remove = suppressContextMenu(window);
    const button = document.body.appendChild(document.createElement("button"));
    const field = document.body.appendChild(document.createElement("textarea"));
    const text = document.body.appendChild(document.createElement("div"));
    text.textContent = "Deploy the fix";
    window.getSelection()?.selectAllChildren(text);

    expect(rightClick(button)).toBe(true);
    expect(rightClick(field)).toBe(true);
    expect(rightClick(text)).toBe(true);

    remove();
    expect(rightClick(button)).toBe(false);
  });
});
