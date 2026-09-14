import { describe, expect, it } from "vitest";

import type { Note } from "./ipc";
import {
  appendTask,
  collectTasks,
  findTodoNote,
  newTodoNote,
  openTaskCount,
  setTaskText,
  taskLine,
  taskReminders,
  tickTask,
} from "./tasks";

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    content: "",
    color: "yellow",
    pinned: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("collectTasks", () => {
  it("gathers tasks by note, in list order, with their line numbers", () => {
    const groceries = note({
      id: "g",
      content: "**Groceries**\n- [ ] milk\n- [x] eggs\nplain line\n- [ ] rice",
      updatedAt: 10,
    });
    const release = note({ id: "r", content: "Release\n1. first\n- [ ] test", updatedAt: 20 });
    const plain = note({ id: "p", content: "Just text\n- bullet", updatedAt: 30 });

    const groups = collectTasks([groceries, release, plain]);

    expect(groups.map((group) => group.note.id)).toEqual(["r", "g"]);
    expect(groups[1]?.title).toBe("Groceries");
    expect(groups[1]?.tasks.map(({ line, text, checked }) => ({ line, text, checked }))).toEqual([
      { line: 1, text: "milk", checked: false },
      { line: 2, text: "eggs", checked: true },
      { line: 4, text: "rice", checked: false },
    ]);
  });

  it("puts locked notes first, as the list does", () => {
    const recent = note({ id: "a", content: "A\n- [ ] one", updatedAt: 50 });
    const locked = note({ id: "b", content: "B\n- [ ] two", updatedAt: 1, pinned: true });
    expect(collectTasks([recent, locked]).map((group) => group.note.id)).toEqual(["b", "a"]);
  });

  it("skips empty task lines and titles a note that starts with a task", () => {
    const groups = collectTasks([note({ id: "t", content: "- [ ] first\n- [ ] " })]);
    expect(groups[0]?.title).toBe("first");
    expect(groups[0]?.tasks).toHaveLength(1);
  });
});

describe("openTaskCount", () => {
  it("counts unticked tasks across notes", () => {
    expect(
      openTaskCount([
        note({ id: "1", content: "A\n- [ ] one\n- [x] two" }),
        note({ id: "2", content: "B\n- [ ] three" }),
      ]),
    ).toBe(2);
  });
});

describe("findTodoNote", () => {
  it("finds the note titled To-Do, ignoring case and formatting", () => {
    const notes = [
      note({ id: "x", content: "Shopping\n- [ ] milk", updatedAt: 30 }),
      note({ id: "t", content: "\n**to-do**\n- [ ] call", updatedAt: 20 }),
    ];
    expect(findTodoNote(notes)?.id).toBe("t");
  });

  it("does not match a title that merely contains the word", () => {
    expect(findTodoNote([note({ id: "a", content: "To-Do later\n- [ ] x" })])).toBeUndefined();
    expect(findTodoNote([note({ id: "b", content: "" })])).toBeUndefined();
  });
});

describe("adding a task", () => {
  it("makes one clean task line from what was typed", () => {
    expect(taskLine("  call   the\nbank ")).toBe("- [ ] call the bank");
    expect(taskLine("   ")).toBeNull();
  });

  it("appends after the last non-blank line", () => {
    expect(appendTask("To-Do\n- [ ] one\n\n", "two")).toBe("To-Do\n- [ ] one\n- [ ] two");
    expect(appendTask("", "first")).toBe("- [ ] first");
    expect(appendTask("To-Do", " ")).toBeNull();
  });

  it("starts a To-Do note with its first task", () => {
    expect(newTodoNote("Pay rent")).toBe("To-Do\n- [ ] Pay rent");
  });
});

describe("tickTask", () => {
  const NOW = new Date(2026, 8, 14, 13, 30);

  it("ticks an ordinary task and unticks it again", () => {
    const content = "List\n- [ ] milk !high";
    expect(tickTask(content, 1, NOW)).toBe("List\n- [x] milk !high");
    expect(tickTask("List\n- [x] milk", 1, NOW)).toBe("List\n- [ ] milk");
  });

  it("moves a repeating task to its next date and keeps it open", () => {
    expect(tickTask("  - [ ] water plants @2026-09-14 repeat:daily", 0, NOW)).toBe(
      "  - [ ] water plants @2026-09-15 repeat:daily",
    );
  });

  it("refuses a line that is not a task", () => {
    expect(tickTask("List\n- milk", 1, NOW)).toBeNull();
  });
});

describe("setTaskText", () => {
  it("replaces the text and keeps the box, tick and indent", () => {
    expect(setTaskText("List\n  - [x] milk", 1, "milk !low")).toBe("List\n  - [x] milk !low");
  });

  it("refuses an empty text or a line that is not a task", () => {
    expect(setTaskText("List\n- [ ] milk", 1, "  ")).toBeNull();
    expect(setTaskText("List", 0, "x")).toBeNull();
  });
});

describe("taskReminders", () => {
  it("reminds for open tasks with a date, at their time or nine in the morning", () => {
    const reminders = taskReminders([
      note({
        id: "n",
        content:
          "Errands\n- [ ] **Call** the bank @2026-09-20 14:00\n- [ ] Pay rent @2026-10-01\n- [x] Done @2026-09-20\n- [ ] Someday",
      }),
    ]);
    expect(reminders).toEqual([
      {
        id: "n|Call the bank|2026-09-20|14:00",
        at: new Date(2026, 8, 20, 14, 0).getTime(),
        title: "Call the bank",
        body: "Due now · Errands",
      },
      {
        id: "n|Pay rent|2026-10-01|",
        at: new Date(2026, 9, 1, 9, 0).getTime(),
        title: "Pay rent",
        body: "Due today · Errands",
      },
    ]);
  });
});
