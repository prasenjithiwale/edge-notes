/**
 * The handful of methods the bundle uses that are newer than the engines this
 * app has to run on.
 *
 * Vite is told to build for `safari15`, and that covers *syntax*: anything newer
 * is rewritten. It does not cover *methods* — a call to something the engine
 * simply does not have is emitted as written and throws when it is reached.
 * Lexical calls `Array.prototype.findLast` and `findLastIndex`, which arrived in
 * Safari 15.4, so on a 15.0-class engine the editor would die the first time it
 * walked a list or a link. The app's floor is macOS 12 and WebKitGTK 4.1
 * (brief 5), and neither is reliably newer than that.
 *
 * Only installed where the method is genuinely missing, so a real engine keeps
 * its own. Imported for its side effect as the first thing `main.tsx` does,
 * before any module that might call one.
 */

type Predicate = (value: unknown, index: number, array: unknown[]) => unknown;

function findLast(this: unknown[], predicate: Predicate): unknown {
  for (let i = this.length - 1; i >= 0; i -= 1) {
    if (predicate(this[i], i, this)) {
      return this[i];
    }
  }
  return undefined;
}

function findLastIndex(this: unknown[], predicate: Predicate): number {
  for (let i = this.length - 1; i >= 0; i -= 1) {
    if (predicate(this[i], i, this)) {
      return i;
    }
  }
  return -1;
}

/**
 * Fill the gaps on `target`, which is `Array.prototype` outside the tests. The
 * prototype is written through a loose record: assigning to it is the point, and
 * the compiler is right that it should not normally happen.
 */
export function installCompat(target: object = Array.prototype): void {
  const proto = target as Record<string, unknown>;
  if (typeof proto["findLast"] !== "function") {
    proto["findLast"] = findLast;
  }
  if (typeof proto["findLastIndex"] !== "function") {
    proto["findLastIndex"] = findLastIndex;
  }
}

installCompat();
