import { describe, expect, it } from "vitest";

import { installCompat } from "./compat";

/** A bare object standing in for a prototype that lacks the two methods. */
function withoutThem(): Record<string, unknown> {
  return {};
}

describe("the compatibility shim", () => {
  it("supplies findLast and findLastIndex where they are missing", () => {
    const proto = withoutThem();
    installCompat(proto);

    const findLast = proto["findLast"] as (
      this: unknown[],
      p: (v: unknown) => unknown,
    ) => unknown;
    const findLastIndex = proto["findLastIndex"] as (
      this: unknown[],
      p: (v: unknown) => unknown,
    ) => number;

    const list = [1, 2, 3, 4];
    expect(findLast.call(list, (n) => (n as number) % 2 === 1)).toBe(3);
    expect(findLastIndex.call(list, (n) => (n as number) % 2 === 1)).toBe(2);
    expect(findLast.call(list, () => false)).toBeUndefined();
    expect(findLastIndex.call(list, () => false)).toBe(-1);
    expect(findLast.call([], () => true)).toBeUndefined();
  });

  it("searches backwards, which is the whole difference from find", () => {
    const proto = withoutThem();
    installCompat(proto);
    const findLast = proto["findLast"] as (this: unknown[], p: (v: unknown) => unknown) => unknown;
    const findLastIndex = proto["findLastIndex"] as (
      this: unknown[],
      p: (v: unknown) => unknown,
    ) => number;

    const list = ["a", "b", "a"];
    const isA = (value: unknown) => value === "a";
    // `find` would answer 0; the last match is what these are for.
    expect(findLastIndex.call(list, isA)).toBe(2);
    expect(findLast.call([1, 2, 3], () => true)).toBe(3);
    expect(findLastIndex.call([], () => true)).toBe(-1);
  });

  it("leaves an engine that already has them alone", () => {
    const own = () => "mine";
    const proto: Record<string, unknown> = { findLast: own, findLastIndex: own };
    installCompat(proto);
    expect(proto["findLast"]).toBe(own);
    expect(proto["findLastIndex"]).toBe(own);
  });
});
