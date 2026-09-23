import { describe, expect, it } from "vitest";

import panel from "../dock/Panel.module.css?raw";
import pomodoro from "../focus/PomodoroView.module.css?raw";

/** The declarations of one rule, by its class name. */
function rule(sheet: string, name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(sheet);
  if (match === null) {
    throw new Error(`no .${name} rule`);
  }
  return match[1] ?? "";
}

/**
 * The panel's own colour (owner's request, 23 Sep 2026 — a deliberate exception
 * to brief 7.1's neutral chrome).
 *
 * What is pinned here is the contract rather than the look: the three places
 * that were asked for read the token, and a panel with no colour chosen falls
 * back to exactly what it said before the setting existed.
 */
describe("the panel's colour", () => {
  it("reaches the header, the toolbar and the focus ring", () => {
    expect(rule(panel, "header")).toContain("var(--accent-bg, transparent)");
    expect(rule(panel, "header")).toContain("var(--accent-ink, inherit)");
    expect(rule(panel, "toolbar")).toContain("var(--accent-bg, transparent)");
    expect(rule(panel, "toolbar")).toContain("var(--accent-ink, inherit)");
    // The ring's metrics and its colour are separate rules, so this asks the
    // sheet rather than one of them.
    expect(pomodoro).toContain("stroke: var(--accent-ink, var(--text-primary))");
  });

  it("always names a fallback, so no colour means the chrome it always had", () => {
    for (const sheet of [panel, pomodoro]) {
      for (const use of sheet.match(/var\(--accent-[a-z]+[^)]*\)/g) ?? []) {
        expect(use, `${use} has no fallback`).toContain(",");
      }
    }
  });
});
