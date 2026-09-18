import { describe, expect, it } from "vitest";

import type { Task } from "./ipc";
import { groupTasks, openTaskCount, overdueCount, taskReminders } from "./tasks";

/** Mon 14 Sep 2026, 13:30 local. */
const NOW = new Date(2026, 8, 14, 13, 30);

let made = 0;
function task(fields: Partial<Task> = {}): Task {
  made += 1;
  return {
    id: `t${String(made)}`,
    title: `task ${String(made)}`,
    notes: "",
    // A stored task always has both, and Rust keeps them in step: a task with a
    // time on it closed. Derived here so a fixture can say either.
    status: fields.doneAt == null ? "open" : "done",
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

describe("groupTasks", () => {
  it("groups by when a task is due, in the order the list shows them", () => {
    const tasks = [
      task({ title: "someday" }),
      task({ title: "later", dueDate: "2026-09-30" }),
      task({ title: "late", dueDate: "2026-09-01" }),
      task({ title: "today", dueDate: "2026-09-14" }),
      task({ title: "tomorrow", dueDate: "2026-09-15" }),
    ];

    expect(groupTasks(tasks, NOW).map((section) => section.kind)).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "upcoming",
      "none",
    ]);
  });

  it("leaves out a section with nothing in it", () => {
    const sections = groupTasks([task({ dueDate: "2026-09-14" })], NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("today");
  });

  it("orders each section by priority, then by when", () => {
    const tasks = [
      task({ title: "plain", dueDate: "2026-09-14" }),
      task({ title: "urgent", dueDate: "2026-09-14", priority: "high" }),
      task({ title: "timed", dueDate: "2026-09-14", dueTime: "23:00" }),
    ];
    expect(groupTasks(tasks, NOW)[0]?.tasks.map((entry) => entry.title)).toEqual([
      "urgent",
      "plain",
      "timed",
    ]);
  });

  it("shows what was finished recently, newest first", () => {
    const tasks = [
      task({ title: "first", doneAt: NOW.getTime() - 60_000 }),
      task({ title: "second", doneAt: NOW.getTime() - 1_000 }),
    ];
    const done = groupTasks(tasks, NOW).find((section) => section.kind === "done");
    expect(done?.tasks.map((entry) => entry.title)).toEqual(["second", "first"]);
  });

  /** A list of what is left should not be mostly what is not. */
  it("stops showing a task completed more than a day ago", () => {
    const tasks = [
      task({ title: "yesterday", doneAt: NOW.getTime() - 25 * 60 * 60 * 1000 }),
      task({ title: "just now", doneAt: NOW.getTime() - 1000 }),
    ];
    const done = groupTasks(tasks, NOW).find((section) => section.kind === "done");
    expect(done?.tasks.map((entry) => entry.title)).toEqual(["just now"]);
  });

  it("puts a task due earlier today at a set time in Overdue", () => {
    const tasks = [task({ dueDate: "2026-09-14", dueTime: "09:00" })];
    expect(groupTasks(tasks, NOW)[0]?.kind).toBe("overdue");
  });

  /**
   * In progress comes first because it is where the reader was, and the two
   * closed sections come last because they are what is already behind them.
   */
  it("puts In progress at the top and the closed sections at the bottom", () => {
    const tasks = [
      task({ title: "someday" }),
      task({ title: "cancelled", status: "cancelled", doneAt: NOW.getTime() - 1 }),
      task({ title: "today", dueDate: "2026-09-14" }),
      task({ title: "done", doneAt: NOW.getTime() - 1 }),
      task({ title: "doing", status: "in_progress", dueDate: "2026-09-30" }),
    ];

    expect(groupTasks(tasks, NOW).map((section) => section.kind)).toEqual([
      "doing",
      "today",
      "none",
      "done",
      "cancelled",
    ]);
  });

  it("stops showing a cancelled task a day after it was cancelled, as it does a finished one", () => {
    const old = NOW.getTime() - 25 * 60 * 60 * 1000;
    const tasks = [
      task({ title: "just cancelled", status: "cancelled", doneAt: NOW.getTime() - 1 }),
      task({ title: "cancelled yesterday", status: "cancelled", doneAt: old }),
    ];

    const sections = groupTasks(tasks, NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.tasks.map((entry) => entry.title)).toEqual(["just cancelled"]);
  });

  /** Both closed sections are histories: newest first, not by priority. */
  it("orders Cancelled by when each task was cancelled", () => {
    const tasks = [
      task({ title: "first", status: "cancelled", doneAt: 1_000, priority: "high" }),
      task({ title: "second", status: "cancelled", doneAt: 2_000 }),
    ];
    const cancelled = groupTasks(tasks, new Date(3_000));
    expect(cancelled[0]?.tasks.map((entry) => entry.title)).toEqual(["second", "first"]);
  });
});

describe("counts", () => {
  it("counts what is still open, whatever it is due", () => {
    const tasks = [task(), task({ dueDate: "2026-09-01" }), task({ doneAt: 1 })];
    expect(openTaskCount(tasks)).toBe(2);
  });

  /**
   * A task in progress is still work and is counted; a cancelled one is not
   * work and is not, which is the whole difference between it and a finished
   * one being uncounted for the opposite reason.
   */
  it("counts a task in progress and not a cancelled one", () => {
    const tasks = [
      task({ status: "in_progress" }),
      task({ status: "cancelled", doneAt: 1 }),
      task(),
    ];
    expect(openTaskCount(tasks)).toBe(2);
  });

  it("counts what is actually late", () => {
    const tasks = [
      task({ dueDate: "2026-09-01" }),
      task({ dueDate: "2026-09-14", dueTime: "09:00" }),
      task({ dueDate: "2026-09-14" }),
      task({ dueDate: "2026-09-01", doneAt: 1 }),
    ];
    expect(overdueCount(tasks, NOW)).toBe(2);
  });

  /**
   * Asked of the date, not of the section: the list lifts a task in progress out
   * of Overdue, and it is still late.
   */
  it("still counts a late task that is being worked on", () => {
    const tasks = [
      task({ status: "in_progress", dueDate: "2026-09-01" }),
      task({ status: "cancelled", doneAt: 1, dueDate: "2026-09-01" }),
    ];
    expect(overdueCount(tasks, NOW)).toBe(1);
  });
});

describe("taskReminders", () => {
  it("is one reminder per open task with a date, at its time", () => {
    const tasks = [
      task({ title: "Call the bank", dueDate: "2026-09-20", dueTime: "14:00" }),
      task({ title: "Whole day", dueDate: "2026-09-20" }),
      task({ title: "No date" }),
      task({ title: "Finished", dueDate: "2026-09-20", doneAt: 1 }),
      // Being reminded about something you decided not to do is the clearest
      // way for a status to be a lie.
      task({
        title: "Cancelled",
        dueDate: "2026-09-20",
        status: "cancelled",
        doneAt: 1,
      }),
      // Still work, so still worth a reminder.
      task({ title: "Started", dueDate: "2026-09-21", status: "in_progress" }),
    ];

    const reminders = taskReminders(tasks);
    expect(reminders.map((reminder) => reminder.title)).toEqual([
      "Call the bank",
      "Whole day",
      "Started",
    ]);
    expect(reminders[0]).toMatchObject({
      title: "Call the bank",
      at: new Date(2026, 8, 20, 14, 0).getTime(),
      body: "Due now",
    });
    expect(reminders[1]).toMatchObject({
      title: "Whole day",
      at: new Date(2026, 8, 20, 9, 0).getTime(),
      body: "Due today",
    });
  });

  /** Rust remembers what it has shown by id, so the id has to move when the task does. */
  it("changes its id when the task moves, and not when it does not", () => {
    const before = task({ id: "a", dueDate: "2026-09-20", dueTime: "14:00" });
    const sameAgain = { ...before, updatedAt: before.updatedAt + 5 };
    const moved = { ...before, dueDate: "2026-09-21" };

    expect(taskReminders([before])[0]?.id).toBe(taskReminders([sameAgain])[0]?.id);
    expect(taskReminders([before])[0]?.id).not.toBe(taskReminders([moved])[0]?.id);
  });

  it("falls back to a name rather than announcing nothing", () => {
    expect(taskReminders([task({ title: "   ", dueDate: "2026-09-20" })])[0]?.title).toBe("Task");
  });
});
