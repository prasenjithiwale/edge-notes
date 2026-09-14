import { describe, expect, it } from "vitest";

import {
  addMonths,
  compareTasks,
  dueLabel,
  dueSection,
  formatTaskText,
  nextOccurrence,
  parseTaskText,
  reminderAt,
  repeatOnTick,
} from "./taskMeta";

/** Mon 14 Sep 2026, 13:30 local. */
const NOW = new Date(2026, 8, 14, 13, 30);

describe("parseTaskText", () => {
  it("reads every token from the end of the line, in any order", () => {
    expect(parseTaskText("Call the bank !high @2026-09-20 14:00 repeat:weekly")).toEqual({
      title: "Call the bank",
      priority: "high",
      due: { date: "2026-09-20", time: "14:00" },
      repeat: "weekly",
    });
    expect(parseTaskText("Pay rent repeat:MONTHLY @2026-10-01 !Low")).toEqual({
      title: "Pay rent",
      priority: "low",
      due: { date: "2026-10-01", time: null },
      repeat: "monthly",
    });
  });

  it("leaves tokens in the middle of a sentence alone", () => {
    expect(parseTaskText("email @john about !bugs today")).toMatchObject({
      title: "email @john about !bugs today",
      priority: null,
      due: null,
    });
  });

  it("pads a one-digit hour", () => {
    expect(parseTaskText("Run @2026-09-15 7:05").due).toEqual({ date: "2026-09-15", time: "07:05" });
  });

  it("keeps a malformed date or time in the title", () => {
    expect(parseTaskText("Party @2026-02-30").due).toBeNull();
    expect(parseTaskText("Party @2026-02-10 25:00").due).toBeNull();
    expect(parseTaskText("Party @2026-02-10 25:00").title).toBe("Party @2026-02-10 25:00");
  });

  it("reads a line that is only tokens", () => {
    expect(parseTaskText("!high")).toEqual({ title: "", priority: "high", due: null, repeat: null });
  });

  it("round-trips through formatTaskText in the canonical order", () => {
    const text = "Pay rent repeat:monthly @2026-10-01 !low";
    expect(formatTaskText(parseTaskText(text))).toBe("Pay rent !low @2026-10-01 repeat:monthly");
    expect(formatTaskText(parseTaskText("Plain"))).toBe("Plain");
  });
});

describe("repeats", () => {
  it("steps by the repeat from the due date", () => {
    expect(nextOccurrence({ date: "2026-09-14", time: "09:00" }, "daily", NOW)).toEqual({
      date: "2026-09-15",
      time: "09:00",
    });
    expect(nextOccurrence({ date: "2026-09-20", time: null }, "weekly", NOW).date).toBe("2026-09-27");
    expect(nextOccurrence({ date: "2026-02-28", time: null }, "yearly", new Date(2026, 0, 1)).date).toBe(
      "2027-02-28",
    );
  });

  it("catches up past today rather than landing in the past", () => {
    expect(nextOccurrence({ date: "2026-09-01", time: null }, "daily", NOW).date).toBe("2026-09-14");
    expect(nextOccurrence({ date: "2026-08-31", time: null }, "weekly", NOW).date).toBe("2026-09-14");
  });

  it("counts from today when there is no date", () => {
    expect(nextOccurrence(null, "weekly", NOW).date).toBe("2026-09-21");
  });

  it("clamps months to their last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("rewrites a repeating task on tick and leaves others to be ticked", () => {
    expect(repeatOnTick("Water plants @2026-09-14 repeat:daily", NOW)).toBe(
      "Water plants @2026-09-15 repeat:daily",
    );
    expect(repeatOnTick("Water plants @2026-09-14", NOW)).toBeNull();
  });
});

describe("dueSection", () => {
  it("sorts dates into overdue, today, upcoming and none", () => {
    expect(dueSection({ date: "2026-09-13", time: null }, NOW)).toBe("overdue");
    expect(dueSection({ date: "2026-09-14", time: null }, NOW)).toBe("today");
    expect(dueSection({ date: "2026-09-14", time: "15:00" }, NOW)).toBe("today");
    expect(dueSection({ date: "2026-09-14", time: "09:00" }, NOW)).toBe("overdue");
    expect(dueSection({ date: "2026-09-15", time: null }, NOW)).toBe("upcoming");
    expect(dueSection(null, NOW)).toBe("none");
  });
});

describe("compareTasks", () => {
  it("puts priority first, then the sooner date, whole-day before timed", () => {
    const tasks = [
      "c @2026-09-16",
      "b !low @2026-09-15",
      "a !high",
      "d @2026-09-15 08:00",
      "e @2026-09-15",
    ].map(parseTaskText);
    expect([...tasks].sort(compareTasks).map((task) => task.title)).toEqual(["a", "b", "e", "d", "c"]);
  });
});

describe("reminderAt", () => {
  it("is the due time, or nine in the morning for a whole-day task", () => {
    expect(reminderAt({ date: "2026-09-20", time: "14:00" })).toBe(new Date(2026, 8, 20, 14, 0).getTime());
    expect(reminderAt({ date: "2026-09-20", time: null })).toBe(new Date(2026, 8, 20, 9, 0).getTime());
  });
});

describe("dueLabel", () => {
  it("uses words near today, weekdays this week, and dates beyond", () => {
    expect(dueLabel({ date: "2026-09-14", time: null }, NOW, "en-GB")).toBe("Today");
    expect(dueLabel({ date: "2026-09-15", time: "14:00" }, NOW, "en-GB")).toBe("Tomorrow, 14:00");
    expect(dueLabel({ date: "2026-09-13", time: null }, NOW, "en-GB")).toBe("Yesterday");
    expect(dueLabel({ date: "2026-09-18", time: null }, NOW, "en-GB")).toBe("Fri");
    expect(dueLabel({ date: "2026-10-02", time: null }, NOW, "en-GB")).toBe("2 Oct");
    expect(dueLabel({ date: "2027-01-05", time: null }, NOW, "en-GB")).toBe("5 Jan 2027");
  });
});
