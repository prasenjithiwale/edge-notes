#!/usr/bin/env bash
# Seed a demo home for the download page's screenshots and videos.
#
#   tools/site_demo.sh <scratch home>
#
# Writes a plaintext notes.db full of invented notes and tasks into
# <scratch home>/Library/Application Support/dev.ledge.app/. Run a *debug* build
# with HOME pointed there and LEDGE_DB_KEY set, and the app encrypts it on first
# open with that key, never touching the real keychain or the real notes:
#
#   HOME=<scratch home> LEDGE_DB_KEY=<64 hex digits> src-tauri/target/debug/ledge
#
# A marketing picture of a notes app is a picture of someone's notes unless you
# arrange otherwise; this is the arranging. Capture protection is switched off
# in this database only, because the point of it here is to be captured.
set -euo pipefail

home=$1
dir="$home/Library/Application Support/dev.ledge.app"
db="$dir/notes.db"
mkdir -p "$dir"
rm -f "$db" "$db"-wal "$db"-shm

now=$(($(date +%s) * 1000))
min=60000
today=$(date +%Y-%m-%d)
tomorrow=$(date -v+1d +%Y-%m-%d)
friday=$(date -v+fri +%Y-%m-%d)
# Local midnight, for today's focus sessions.
midnight=$(($(date -j -f "%Y-%m-%d %H:%M:%S" "$today 00:00:00" +%s) * 1000))
at() { echo $((midnight + ($1 * 60 + $2) * min)); }
id() { uuidgen | tr '[:upper:]' '[:lower:]'; }
q() { printf "%s" "$1" | sed "s/'/''/g"; }

note() { # colour, minutes ago, pinned, content
  local t=$((now - $2 * min))
  echo "INSERT INTO notes (id, content, color, pinned, created_at, updated_at)
        VALUES ('$(id)', '$(q "$4")', '$1', $3, $t, $t);"
}
task() { # title, status, due date or NULL, due time or NULL, priority or NULL, notes
  local done=NULL
  [ "$2" = done ] && done=$((now - 30 * min))
  echo "INSERT INTO tasks (id, title, notes, status, done_at, due_date, due_time, priority,
          created_at, updated_at)
        VALUES ('$(id)', '$(q "$1")', '$(q "${6-}")', '$2', $done, $3, $4, $5, $now, $now);"
}
setting() { echo "INSERT INTO settings (key, value) VALUES ('$1', '$(q "$2")');"; }

{
  cat <<'SQL'
CREATE TABLE notes (
  id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', color TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0, sort_order REAL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX idx_notes_active ON notes (deleted_at, updated_at DESC);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  done_at INTEGER, due_date TEXT, due_time TEXT, priority TEXT, repeat_rule TEXT,
  sort_order REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  deleted_at INTEGER, status TEXT NOT NULL DEFAULT 'open'
);
CREATE INDEX idx_tasks_active ON tasks (deleted_at, done_at, due_date);
PRAGMA user_version = 4;
SQL

  note yellow 3 0 "# Launch checklist
Ship the new look on Thursday. Screenshots, then the changelog, then the release. #work"
  note indigo 10 0 "# Design review, Thursday
## What we are showing
- The panel as frosted glass over the desktop
- Notes lit by their own colour
- Calligraphy for titles, never for text you read at length
## Decisions
- [x] Aurora glass for the whole app
- [x] Keep the sixteen note colours
- [ ] Record a short demo of the panel opening

| Screen | Owner | Status |
| --- | --- | --- |
| Notes | Design | Done |
| Focus | Design | Done |
| Tasks | Engineering | In review |

Next: the download page, in the same look. #work"
  note sky 20 0 "# Groceries
- [x] Oat milk
- [ ] Sourdough
- [ ] Lemons, 4
- [ ] Coffee beans"
  note green 55 0 "# Reading
Chapter 6 of **The Design of Everyday Things** before the book club on Friday. #books"
  note lavender 90 0 "# Deploy
\`\`\`shell
git tag v0.10.0 && git push --tags
\`\`\`
Then watch the release workflow."
  note pink 180 0 "# Kyoto in November
- [x] Flights
- [ ] Ryokan for two nights
- [ ] Fushimi Inari at sunrise #travel"
  note peach 300 0 "# Ideas
A calmer Monday: no meetings before 11, and one thing finished before lunch."

  task "Record the demo video" in_progress "'$today'" "'16:00'" "'high'" "Panel open, then a focus session."
  task "Write the release notes" open "'$today'" NULL "'medium'"
  task "Book the ryokan" open "'$tomorrow'" "'10:00'" NULL
  task "Book club: chapter 6" open "'$friday'" "'18:30'" "'low'"
  task "Renew passport" open NULL NULL NULL
  task "Fix the settings stepper" done "'$today'" NULL NULL

  setting privacy.hideFromCapture false
  setting theme '"light"'
  setting dock.side '"right"'
  setting focus.day "\"$today\""
  setting focus.today 3
  setting focus.streak 3
  setting focus.log "[[$(at 9 0),$(at 9 25)],[$(at 9 35),$(at 10 0)],[$(at 10 30),$(at 11 20)]]"
} | sqlite3 "$db"

echo "seeded $db"
