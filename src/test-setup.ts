/**
 * The bits of the DOM jsdom leaves out that the tests need, and nothing else.
 *
 * jsdom implements no layout, so anything that measures returns nothing or is
 * missing outright. Most of the app copes with that on its own — `TasksView`
 * feature-detects `scrollIntoView` because a real engine could lack it too — but
 * the editor cannot: Lexical scrolls the caret into view after it commits an
 * update, which means measuring a `Range`, and jsdom has no
 * `Range.prototype.getBoundingClientRect` at all. The throw lands in a
 * microtask after the test that caused it, so it surfaces as an unhandled error
 * that fails the whole run while every test still passes.
 *
 * A zero rect is the honest answer here: there is no layout, so nothing is on
 * screen, and "needs scrolling into view" is false for everything. What these
 * must never do is hide a real failure, so they are only installed where the
 * method is genuinely absent.
 */
function zeroRect(): DOMRect {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  return { ...rect, toJSON: () => rect };
}

if (typeof Range !== "undefined") {
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = zeroRect;
  }
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  }
}
