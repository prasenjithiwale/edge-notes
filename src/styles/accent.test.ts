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
  it("lights the aura at rest", () => {
    // Aurora glass (24 Sep 2026): the chrome is glass, and the colour chosen in
    // Settings is the light under it while no session is running. The header
    // and toolbar no longer wear it as a flat band.
    expect(panel).toContain("var(--accent-bg, var(--aura-idle-1))");
    expect(rule(panel, "header")).not.toContain("--accent-bg");
  });

  it("always names a fallback, so no colour means the chrome it always had", () => {
    for (const sheet of [panel, pomodoro]) {
      for (const use of sheet.match(/var\(--accent-[a-z]+[^)]*\)/g) ?? []) {
        expect(use, `${use} has no fallback`).toContain(",");
      }
    }
  });
});
