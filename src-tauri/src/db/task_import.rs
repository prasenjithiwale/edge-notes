//! Reading the old task format out of note text, for the one migration that
//! moves tasks into a table of their own.
//!
//! Until v3, a task was a `- [ ]` line inside a note, with its details as tokens
//! at the end of the line:
//!
//! ```text
//! - [ ] Call the bank !high @2026-09-20 14:00 repeat:weekly
//! ```
//!
//! This module is the only place that still understands that, and it exists to
//! be run once per database. It mirrors `lib/markdown.ts`'s list-item rule and
//! `lib/taskMeta.ts`'s token rule, including reading tokens only from the end of
//! the line so "email @john" in the middle of a sentence was never a due date.
//!
//! Hand-rolled rather than regex: this is the only pattern matching in the Rust
//! side, and it does not justify a new dependency.

use super::tasks::{Priority, Repeat};

/// One task recovered from a note's line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTask {
    pub title: String,
    pub done: bool,
    pub priority: Option<Priority>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub repeat: Option<Repeat>,
}

/// A note's lines, sorted into the tasks to lift out and the text left behind.
#[derive(Debug, Default)]
pub struct Extraction {
    pub tasks: Vec<ImportedTask>,
    /// The note's content with its task lines removed.
    pub content: String,
}

/// Is this line a checklist item, and is its box ticked? Mirrors `LIST_ITEM` in
/// `lib/markdown.ts`: an optional indent, a `-`, `*` or `+`, whitespace, then a
/// box holding a space, `x` or `X`, then whitespace or the end of the line.
fn task_line(line: &str) -> Option<(bool, &str)> {
    let rest = line.trim_start_matches([' ', '\t']);
    let mut chars = rest.char_indices();

    let (_, marker) = chars.next()?;
    if !matches!(marker, '-' | '*' | '+') {
        return None;
    }

    let after_marker = rest[marker.len_utf8()..].trim_start_matches([' ', '\t']);
    if after_marker.len() == rest.len() - marker.len_utf8() {
        // No whitespace after the marker: "-[ ]" is not a list item.
        return None;
    }

    let mut box_chars = after_marker.chars();
    if box_chars.next() != Some('[') {
        return None;
    }
    let check = box_chars.next()?;
    if !matches!(check, ' ' | 'x' | 'X') {
        return None;
    }
    if box_chars.next() != Some(']') {
        return None;
    }

    let text = &after_marker[3 + '['.len_utf8() - 1..];
    // The box must be followed by whitespace or nothing at all.
    if !text.is_empty() && !text.starts_with([' ', '\t']) {
        return None;
    }
    Some((check != ' ', text.trim()))
}

/// `HH:MM` or `H:MM`, 24-hour, as `lib/taskMeta.ts` accepts it. Returned padded.
fn parse_time(token: &str) -> Option<String> {
    let (hours, minutes) = token.split_once(':')?;
    if hours.is_empty() || hours.len() > 2 || minutes.len() != 2 {
        return None;
    }
    let hours: u32 = hours.parse().ok()?;
    let minutes: u32 = minutes.parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(format!("{hours:02}:{minutes:02}"))
}

/// Whether a year-month-day is a real calendar date, so `2026-02-30` is not one.
fn is_valid_date(year: i32, month: u32, day: u32) -> bool {
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let last = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= last
}

/// `@YYYY-MM-DD`, returned without the `@`.
fn parse_due_date(token: &str) -> Option<String> {
    let date = token.strip_prefix('@')?;
    let parts: Vec<&str> = date.split('-').collect();
    let [year, month, day] = parts.as_slice() else {
        return None;
    };
    if year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return None;
    }
    let year: i32 = year.parse().ok()?;
    let month: u32 = month.parse().ok()?;
    let day: u32 = day.parse().ok()?;
    is_valid_date(year, month, day).then(|| date.to_owned())
}

/// The text before the last whitespace-separated token, trimmed.
fn without_last(text: &str) -> &str {
    match text.rfind([' ', '\t']) {
        Some(index) => text[..index].trim_end(),
        None => "",
    }
}

fn last_token(text: &str) -> &str {
    match text.rfind([' ', '\t']) {
        Some(index) => &text[index + 1..],
        None => text,
    }
}

/// Peel the detail tokens off the end of a task's text, each kind at most once,
/// in any order — exactly as `parseTaskText` does. What is left is the title.
fn parse_task_text(text: &str) -> ImportedTask {
    let mut rest = text.trim();
    let mut priority = None;
    let mut due_date = None;
    let mut due_time = None;
    let mut repeat = None;

    loop {
        if rest.is_empty() {
            break;
        }
        let token = last_token(rest);

        if priority.is_none() {
            if let Some(value) = token
                .strip_prefix('!')
                .and_then(|name| Priority::parse(&name.to_lowercase()).ok())
            {
                priority = Some(value);
                rest = without_last(rest);
                continue;
            }
        }

        if repeat.is_none() {
            if let Some(value) = token
                .strip_prefix("repeat:")
                .and_then(|name| Repeat::parse(&name.to_lowercase()).ok())
            {
                repeat = Some(value);
                rest = without_last(rest);
                continue;
            }
        }

        if due_date.is_none() {
            // A time only counts as one when a date stands in front of it.
            if let Some(time) = parse_time(token) {
                let head = without_last(rest);
                if let Some(date) = parse_due_date(last_token(head)) {
                    due_date = Some(date);
                    due_time = Some(time);
                    rest = without_last(head);
                    continue;
                }
            }
            if let Some(date) = parse_due_date(token) {
                due_date = Some(date);
                rest = without_last(rest);
                continue;
            }
        }

        break;
    }

    ImportedTask {
        title: rest.trim().to_owned(),
        done: false,
        priority,
        due_date,
        due_time,
        repeat,
    }
}

/// Split a note's content into the tasks it held and the text that is left.
///
/// A task line with nothing but a box is dropped rather than imported as a task
/// with no title, matching the old Tasks tab, which never showed one.
#[must_use]
pub fn extract(content: &str) -> Extraction {
    let mut tasks = Vec::new();
    let mut kept: Vec<&str> = Vec::new();

    for line in content.split('\n') {
        match task_line(line) {
            Some((done, text)) if !text.trim().is_empty() => {
                let mut task = parse_task_text(text);
                task.done = done;
                if task.title.is_empty() {
                    // Only tokens, no words: keep the line rather than make a
                    // task with nothing to show.
                    kept.push(line);
                } else {
                    tasks.push(task);
                }
            }
            _ => kept.push(line),
        }
    }

    // Trailing blank lines left behind by the removal are not content.
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }

    Extraction {
        tasks,
        content: kept.join("\n"),
    }
}

/// Whether what is left of a note is worth keeping: anything at all, unless the
/// only line is the heading the dedicated task note used to carry.
#[must_use]
pub fn is_leftover_empty(content: &str) -> bool {
    let mut lines = content.lines().filter(|line| !line.trim().is_empty());
    let Some(first) = lines.next() else {
        return true;
    };
    if lines.next().is_some() {
        return false;
    }
    let title = first.trim().to_lowercase();
    title == "tasks" || title == "to-do"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(text: &str) -> ImportedTask {
        parse_task_text(text)
    }

    #[test]
    fn reads_a_plain_task() {
        let parsed = task("Call the bank");
        assert_eq!(parsed.title, "Call the bank");
        assert_eq!(parsed.priority, None);
        assert_eq!(parsed.due_date, None);
        assert_eq!(parsed.repeat, None);
    }

    #[test]
    fn reads_every_token_in_the_documented_order() {
        let parsed = task("Call the bank !high @2026-09-20 14:00 repeat:weekly");
        assert_eq!(parsed.title, "Call the bank");
        assert_eq!(parsed.priority, Some(Priority::High));
        assert_eq!(parsed.due_date.as_deref(), Some("2026-09-20"));
        assert_eq!(parsed.due_time.as_deref(), Some("14:00"));
        assert_eq!(parsed.repeat, Some(Repeat::Weekly));
    }

    #[test]
    fn reads_tokens_in_any_order() {
        let parsed = task("Pay rent repeat:monthly @2026-10-01 !medium");
        assert_eq!(parsed.title, "Pay rent");
        assert_eq!(parsed.priority, Some(Priority::Medium));
        assert_eq!(parsed.due_date.as_deref(), Some("2026-10-01"));
        assert_eq!(parsed.repeat, Some(Repeat::Monthly));
    }

    #[test]
    fn pads_a_single_digit_hour() {
        let parsed = task("Stand-up @2026-09-20 9:30");
        assert_eq!(parsed.due_time.as_deref(), Some("09:30"));
    }

    #[test]
    fn leaves_mid_sentence_lookalikes_in_the_title() {
        let parsed = task("email @john about the !urgent repeat:offer thing");
        assert_eq!(
            parsed.title,
            "email @john about the !urgent repeat:offer thing"
        );
        assert_eq!(parsed.priority, None);
        assert_eq!(parsed.due_date, None);
        assert_eq!(parsed.repeat, None);
    }

    #[test]
    fn refuses_a_date_that_is_not_one() {
        let parsed = task("Nothing @2026-02-30");
        assert_eq!(parsed.title, "Nothing @2026-02-30");
        assert_eq!(parsed.due_date, None);
    }

    #[test]
    fn refuses_an_impossible_time_and_keeps_the_date() {
        let parsed = task("Late @2026-09-20 25:00");
        assert_eq!(parsed.title, "Late @2026-09-20 25:00");
        assert_eq!(parsed.due_date, None);
    }

    #[test]
    fn takes_a_leap_day_but_not_in_a_common_year() {
        assert_eq!(
            task("Leap @2028-02-29").due_date.as_deref(),
            Some("2028-02-29")
        );
        assert_eq!(task("Leap @2027-02-29").due_date, None);
    }

    #[test]
    fn recognises_the_list_markers_and_the_box() {
        assert_eq!(task_line("- [ ] one"), Some((false, "one")));
        assert_eq!(task_line("* [x] two"), Some((true, "two")));
        assert_eq!(task_line("  + [X] three"), Some((true, "three")));
        assert_eq!(task_line("\t- [ ] four"), Some((false, "four")));
        assert_eq!(task_line("- [ ]"), Some((false, "")));
    }

    #[test]
    fn is_not_fooled_by_near_misses() {
        assert_eq!(task_line("-[ ] no space"), None);
        assert_eq!(task_line("- [] empty box"), None);
        assert_eq!(task_line("- [y] wrong mark"), None);
        assert_eq!(task_line("- [ ]x no gap"), None);
        assert_eq!(task_line("plain text"), None);
        assert_eq!(task_line("- bullet"), None);
    }

    #[test]
    fn lifts_tasks_out_and_leaves_the_rest() {
        let extracted = extract("Shopping\n- [ ] Milk\nsome prose\n- [x] Eggs !low\n");
        assert_eq!(extracted.content, "Shopping\nsome prose");
        assert_eq!(extracted.tasks.len(), 2);
        assert_eq!(extracted.tasks[0].title, "Milk");
        assert!(!extracted.tasks[0].done);
        assert_eq!(extracted.tasks[1].title, "Eggs");
        assert!(extracted.tasks[1].done);
        assert_eq!(extracted.tasks[1].priority, Some(Priority::Low));
    }

    #[test]
    fn keeps_a_task_line_that_has_no_words() {
        let extracted = extract("- [ ] \n- [ ] real");
        assert_eq!(extracted.content, "- [ ] ");
        assert_eq!(extracted.tasks.len(), 1);
    }

    #[test]
    fn recognises_a_note_that_was_only_a_task_list() {
        assert!(is_leftover_empty(""));
        assert!(is_leftover_empty("\n  \n"));
        assert!(is_leftover_empty("Tasks"));
        assert!(is_leftover_empty("To-Do"));
        assert!(!is_leftover_empty("Tasks\nand a thought"));
        assert!(!is_leftover_empty("Shopping"));
    }
}
