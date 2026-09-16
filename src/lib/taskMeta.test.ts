import { describe, expect, it } from "vitest";

import type { Task } from "./ipc";
import {
  addMonths,
  compareTasks,
  dueLabel,
  dueSection,
  hasQuickDetails,
  nextOccurrence,
  parseTaskText,
  reminderAt,
  taskSection,
} from "./taskMeta";

/** Mon 14 Sep 2026, 13:30 local. */
const NOW = new Date(2026, 8, 14, 13, 30);

let made = 0;
function task(fields: Partial<Task> = {}): Task {
  made += 1;
  return {
    id: `t${String(made)}`,
    title: "",
    notes: "",
    doneAt: null,
    dueDate: null,
    dueTime: null,
    priority: null,
    repeat: null,
    createdAt: made,
    updatedAt: made,
    ...fields,
  };
}

/**
 * Quick entry: the tokens are no longer how a task is stored, but typing them
 * into the add field still fills the fields in.
 */
describe("parseTaskText", () => {
  it("reads every token from the end of the line, in any order", () => {
    expect(parseTaskText("Call the bank !high @2026-09-20 14:00 repeat:weekly", NOW)).toEqual({
      title: "Call the bank",
      priority: "high",
      due: { date: "2026-09-20", time: "14:00" },
      repeat: "weekly",
    });
    expect(parseTaskText("Pay rent repeat:MONTHLY @2026-10-01 !Low", NOW)).toEqual({
      title: "Pay rent",
      priority: "low",
      due: { date: "2026-10-01", time: null },
      repeat: "monthly",
    });
  });

  it("leaves tokens in the middle of a sentence alone", () => {
    expect(parseTaskText("email @john about !bugs today", NOW)).toMatchObject({
      title: "email @john about !bugs today",
      priority: null,
      due: null,
    });
  });

  it("pads a one-digit hour", () => {
    expect(parseTaskText("Run @2026-09-15 7:05", NOW).due).toEqual({ date: "2026-09-15", time: "07:05" });
  });

  it("keeps a malformed date or time in the title", () => {
    expect(parseTaskText("Party @2026-02-30", NOW).due).toBeNull();
    expect(parseTaskText("Party @2026-02-10 25:00", NOW).due).toBeNull();
    expect(parseTaskText("Party @2026-02-10 25:00", NOW).title).toBe("Party @2026-02-10 25:00");
  });

  it("reads a line that is only tokens", () => {
    expect(parseTaskText("!high", NOW)).toEqual({ title: "", priority: "high", due: null, repeat: null });
  });

  it("collapses the whitespace a title was typed with", () => {
    expect(parseTaskText("  Call   the bank  ", NOW).title).toBe("Call the bank");
  });

  /**
   * The point of the words: a widget's add field is typed into in a hurry, and
   * nobody in a hurry writes a date in ISO.
   */
  it("reads a date written as a word", () => {
    expect(parseTaskText("Ship it @today", NOW).due).toEqual({ date: "2026-09-14", time: null });
    expect(parseTaskText("Ship it @tomorrow", NOW).due).toEqual({
      date: "2026-09-15",
      time: null,
    });
    // Monday the 14th: "@thu" is the Thursday coming.
    expect(parseTaskText("Ship it @thu", NOW).due).toEqual({ date: "2026-09-17", time: null });
    expect(parseTaskText("Ship it @thursday", NOW).due?.date).toBe("2026-09-17");
  });

  /** Today is a Monday, and a task for today would have been typed "@today". */
  it("reads a weekday as the next one, never the day it is typed on", () => {
    expect(parseTaskText("Ship it @mon", NOW).due).toEqual({ date: "2026-09-21", time: null });
  });

  it("reads a time written with am or pm", () => {
    expect(parseTaskText("Call @tomorrow 2pm", NOW).due).toEqual({
      date: "2026-09-15",
      time: "14:00",
    });
    expect(parseTaskText("Call @tomorrow 2:30 PM", NOW).due?.time).toBe("14:30");
    expect(parseTaskText("Call @tomorrow 12am", NOW).due?.time).toBe("00:00");
    expect(parseTaskText("Call @tomorrow 12pm", NOW).due?.time).toBe("12:00");
  });

  it("reads the exclamation shorthand", () => {
    expect(parseTaskText("Ship it !!!", NOW).priority).toBe("high");
    expect(parseTaskText("Ship it !!", NOW).priority).toBe("medium");
    expect(parseTaskText("Ship it !!!", NOW).title).toBe("Ship it");
  });

  /** A word that is not a date is a word: the title keeps it rather than a guess. */
  it("leaves an @ that names no date in the title", () => {
    const quick = parseTaskText("Reply to @janet", NOW);
    expect(quick.due).toBeNull();
    expect(quick.title).toBe("Reply to @janet");
  });

  it("refuses digits after a date word that are not a time", () => {
    expect(parseTaskText("Ship it @fri 99", NOW).due).toBeNull();
    expect(parseTaskText("Ship it @fri 13pm", NOW).due).toBeNull();
  });

  it("says whether it found anything, for the preview under the field", () => {
    expect(hasQuickDetails(parseTaskText("Just a task", NOW))).toBe(false);
    expect(hasQuickDetails(parseTaskText("Just a task @today", NOW))).toBe(true);
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

});

describe("dueSection", () => {
  it("sorts dates into overdue, today, tomorrow, upcoming and none", () => {
    expect(dueSection({ date: "2026-09-13", time: null }, NOW)).toBe("overdue");
    expect(dueSection({ date: "2026-09-14", time: null }, NOW)).toBe("today");
    expect(dueSection({ date: "2026-09-14", time: "15:00" }, NOW)).toBe("today");
    expect(dueSection({ date: "2026-09-14", time: "09:00" }, NOW)).toBe("overdue");
    expect(dueSection({ date: "2026-09-15", time: null }, NOW)).toBe("tomorrow");
    expect(dueSection({ date: "2026-09-16", time: null }, NOW)).toBe("upcoming");
    expect(dueSection(null, NOW)).toBe("none");
  });
});

describe("taskSection", () => {
  it("puts a completed task in Done, whatever it was due", () => {
    expect(taskSection(task({ dueDate: "2026-09-13" }), NOW)).toBe("overdue");
    expect(taskSection(task({ dueDate: "2026-09-13", doneAt: 1 }), NOW)).toBe("done");
    expect(taskSection(task({ doneAt: 1 }), NOW)).toBe("done");
  });
});

describe("compareTasks", () => {
  it("puts priority first, then the sooner date, whole-day before timed", () => {
    const tasks = [
      task({ title: "c", dueDate: "2026-09-16" }),
      task({ title: "b", priority: "low", dueDate: "2026-09-15" }),
      task({ title: "a", priority: "high" }),
      task({ title: "d", dueDate: "2026-09-15", dueTime: "08:00" }),
      task({ title: "e", dueDate: "2026-09-15" }),
    ];
    expect([...tasks].sort(compareTasks).map((entry) => entry.title)).toEqual([
      "a",
      "b",
      "e",
      "d",
      "c",
    ]);
  });

  it("falls back to the order they were made in, so a plain list keeps its own", () => {
    const first = task({ title: "first", createdAt: 10 });
    const second = task({ title: "second", createdAt: 20 });
    expect([second, first].sort(compareTasks).map((entry) => entry.title)).toEqual([
      "first",
      "second",
    ]);
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
