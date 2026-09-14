// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { allowsContextMenu, suppressContextMenu } from "./contextMenu";

function rightClick(target: Element): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("allowsContextMenu (brief 7.5)", () => {
  it("keeps the menu in text fields", () => {
    expect(allowsContextMenu(document.createElement("textarea"), "")).toBe(true);
    expect(allowsContextMenu(document.createElement("input"), "")).toBe(true);
  });

  it("keeps it over selected text, so a pinned note can be copied", () => {
    expect(allowsContextMenu(document.createElement("div"), "Deploy the fix")).toBe(true);
  });

  it("suppresses it on chrome", () => {
    expect(allowsContextMenu(document.createElement("button"), "")).toBe(false);
    expect(allowsContextMenu(document.createElement("div"), "   ")).toBe(false);
  });
});

describe("suppressContextMenu", () => {
  it("prevents the menu on chrome and leaves text fields alone", () => {
    const remove = suppressContextMenu(window);
    const button = document.body.appendChild(document.createElement("button"));
    const field = document.body.appendChild(document.createElement("textarea"));

    expect(rightClick(button)).toBe(true);
    expect(rightClick(field)).toBe(false);

    remove();
    expect(rightClick(button)).toBe(false);
  });
});
