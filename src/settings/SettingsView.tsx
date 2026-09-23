import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Minus, Plus } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { acceleratorFromEvent, formatAccelerator } from "../lib/accelerator";
import {
  appInfo,
  autostartGet,
  autostartSet,
  isIpcErrorOf,
  monitorsList,
  notesExport,
  NOTE_COLORS,
  openUrl,
  securityRecoveryKey,
  securityStatus,
  shortcutSet,
  onUpdateAvailable,
  updateCheck,
  updateInstall,
  updateStatus,
  type AppInfo,
  type NoteColor,
  type SecurityStatus,
  type Settings,
  type UpdateStatus,
} from "../lib/ipc";
import { copyText } from "../lib/clipboard";
import { useDockStore } from "../store/dock";
import { colorName } from "../lib/notes";
import { useNotesStore } from "../store/notes";
import { applyPanelTranslucency, applyTabSize, useSettingsStore } from "../store/settings";
import styles from "./SettingsView.module.css";
import {
  PANEL_TRANSLUCENCY,
  PANEL_WIDTH,
  DELAY,
  FOCUS_MINUTES,
  LONG_BREAK_EVERY,
  clampSetting,
  type Range,
} from "./limits";

interface SettingsViewProps {
  onClose: () => void;
}

interface NumberSettingProps {
  label: string;
  unit: string;
  value: number;
  range: Range;
  step: number;
  onCommit: (value: number) => void;
  onFocus: () => void;
  onBlur: () => void;
  disabled?: boolean;
}

/**
 * A number field that clamps when you finish, not while you type.
 *
 * Clamping on every keystroke made multi-digit values impossible: typing "400"
 * into a 280–420 field went 4 → 280, then "2800" → 420. The draft is local until
 * blur or Enter, so the value only has to be sensible once.
 */
function NumberSetting({
  label,
  unit,
  value,
  range,
  step,
  onCommit,
  onFocus,
  onBlur,
  disabled = false,
}: NumberSettingProps) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Follow the stored value while the field is idle, so a change made elsewhere
  // shows up without stamping on a half-typed number. Adjusted during render
  // rather than in an effect — React's own recipe for this — so there is no
  // second pass with a stale value on screen.
  if (!editing && value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const clamped = clampSetting(draft, range);
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <label className={styles.row}>
      <Label text={label} />
      <span className={styles.control}>
        <input
          type="number"
          className={styles.number}
          value={draft}
          min={range.min}
          max={range.max}
          step={step}
          disabled={disabled}
          onFocus={() => {
            setEditing(true);
            onFocus();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={() => {
            setEditing(false);
            commit();
            onBlur();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
        />
        <span className={styles.unit}>{unit}</span>
      </span>
    </label>
  );
}

interface Choice<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSettingProps<T extends string> {
  legend: string;
  description?: string | undefined;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * A row of mutually exclusive buttons, like a native segmented control.
 *
 * One rule decides the shape of every setting here: a choice of more than two
 * options gets a line of its own, because three legible segments do not fit
 * beside a label at the narrowest panel width; everything else is a row with the
 * label on the left and the control on the right. The view used to mix the two
 * without a reason, which read as two half-finished forms.
 */
function SegmentedSetting<T extends string>({
  legend,
  description,
  choices,
  value,
  onChange,
}: SegmentedSettingProps<T>) {
  return (
    // A `div` with `role="group"`, not a `fieldset` with a `legend`: WebKit
    // renders a legend outside the flow of a flex fieldset, which put the name
    // and its control back on one cramped line.
    <div className={cx(styles.row, styles.stacked)} role="group" aria-label={legend}>
      <Label text={legend} description={description} />
      <div className={styles.segmented}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={styles.segment}
            aria-pressed={value === choice.value}
            onClick={() => {
              onChange(choice.value);
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SwitchSettingProps {
  label: string;
  description?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * A boolean, as a switch rather than an On/Off pair of segments: two segments
 * asked the eye to read both labels to find out which way a setting was set.
 */
function SwitchSetting({
  label,
  description,
  checked,
  onChange,
  onFocus,
  onBlur,
}: SwitchSettingProps) {
  return (
    <div className={styles.row}>
      <Label text={label} description={description} />
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // The label is a sibling `span`, and `aria-labelledby` takes a list of
        // ids: a label with a space in it would be read as two of them.
        aria-label={label}
        className={styles.switch}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={() => {
          onChange(!checked);
        }}
      >
        <span className={styles.knob} />
      </button>
    </div>
  );
}

interface SliderSettingProps {
  label: string;
  value: number;
  range: Range;
  step: number;
  /** While dragging: show the value without storing it. */
  onPreview: (value: number) => void;
  /** Once released: store it. */
  onCommit: (value: number) => void;
}

/**
 * A slider with its value as a percentage beside it. Dragging previews every
 * step and stores only the value it is released at, so a drag is one write, not
 * one per step; the keyboard commits each change, which is what a key press is.
 */
function SliderSetting({ label, value, range, step, onPreview, onCommit }: SliderSettingProps) {
  const [draft, setDraft] = useState(value);
  const [dragging, setDragging] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Follow the stored value when it changes elsewhere, but not mid-drag.
  if (!dragging && value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = (next: number) => {
    setDragging(false);
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <label className={styles.row}>
      <Label text={label} />
      <span className={styles.control}>
        <input
          type="range"
          className={styles.slider}
          min={range.min}
          max={range.max}
          step={step}
          value={draft}
          aria-valuetext={`${String(draft)}%`}
          onPointerDown={() => {
            setDragging(true);
          }}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(next);
            onPreview(next);
          }}
          onPointerUp={(event) => {
            commit(Number(event.currentTarget.value));
          }}
          onKeyUp={(event) => {
            commit(Number(event.currentTarget.value));
          }}
          onBlur={(event) => {
            commit(Number(event.currentTarget.value));
          }}
        />
        <output className={styles.percent}>{`${String(draft)}%`}</output>
      </span>
    </label>
  );
}

interface ShortcutSettingProps {
  /** Which shortcut this row is, for `shortcut_set` and for the label's id. */
  which: "newNote" | "quickCapture" | "clipboardNote";
  label: string;
  description: string | undefined;
  accelerator: string;
  onRecord: (accelerator: string) => void;
  error: string | null;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Records the shortcut by listening for it, instead of asking for Tauri's
 * accelerator syntax as free text.
 *
 * The listener is on `window` in the capture phase so the press never reaches
 * the panel's own keyboard cascade — recording ⌘F should store ⌘F, not open
 * search. A press with no Ctrl, Alt or Cmd is ignored and recording continues,
 * because a global shortcut on a bare key would take that key from every other
 * application.
 */
function ShortcutSetting({
  which,
  label,
  description,
  accelerator,
  onRecord,
  error,
  onFocus,
  onBlur,
}: ShortcutSettingProps) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    if (!recording) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        setHint(false);
        return;
      }
      const next = acceleratorFromEvent(event);
      if (next === null) {
        // Modifiers on their own are the start of a shortcut, not a mistake;
        // only a complete press without one earns the hint.
        setHint(!event.ctrlKey && !event.altKey && !event.metaKey);
        return;
      }
      setRecording(false);
      setHint(false);
      onRecord(next);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [recording, onRecord]);

  const message = hint
    ? "Hold ⌘, ⌃ or ⌥ as well"
    : recording
      ? "Press the keys, or Esc to cancel"
      : error;

  return (
    <>
      <div className={styles.row}>
        <span className={styles.labelWrap} id={`shortcut-label-${which}`}>
          <span className={styles.label}>{label}</span>
          {description !== undefined && (
            <span className={styles.description}>{description}</span>
          )}
        </span>
        <button
          type="button"
          className={styles.recorder}
          aria-labelledby={`shortcut-label-${which}`}
          aria-describedby={message === null ? undefined : `shortcut-message-${which}`}
          data-recording={recording ? "" : undefined}
          onFocus={onFocus}
          onBlur={() => {
            setRecording(false);
            setHint(false);
            onBlur();
          }}
          onClick={() => {
            setRecording((value) => !value);
            setHint(false);
          }}
        >
          {recording ? "Press a shortcut" : formatAccelerator(accelerator) || "Not set"}
        </button>
      </div>
      {message !== null && (
        <p
          id={`shortcut-message-${which}`}
          className={error !== null && !recording && !hint ? styles.error : styles.note}
          role={error !== null && !recording && !hint ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </>
  );
}

/**
 * One group of settings, as an inset card with hairlines between its rows.
 *
 * The view used to be four headings over one continuous column of controls, and
 * at a glance it read as a single list of fourteen things. Boxing each group is
 * what every system preferences pane does, and for the same reason: the eye
 * finds a card of three rows without reading any of them.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      <div className={styles.card}>{children}</div>
    </section>
  );
}

/**
 * A row's name, and the sentence that saves having to guess what it does.
 * The name is primary text: everything here was secondary, which made the whole
 * pane read as small print.
 */
function Label({ text, description }: { text: string; description?: string | undefined }) {
  return (
    <span className={styles.labelWrap}>
      <span className={styles.label}>{text}</span>
      {description !== undefined && <span className={styles.description}>{description}</span>}
    </span>
  );
}

/**
 * The settings that are rarely touched, folded away behind one row.
 *
 * Two hover delays and a panel width are worth having and are not worth being
 * the first thing anyone sees; three of the fourteen rows earned their place
 * here rather than being removed.
 */
function Advanced({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cx(styles.row, styles.disclosure)}
        aria-expanded={open}
        onClick={() => {
          setOpen((shown) => !shown);
        }}
      >
        <Label text="Advanced" />
        <ChevronRight
          size={13}
          strokeWidth={2}
          className={cx(styles.chevron, open && styles.chevronOpen)}
          aria-hidden="true"
        />
      </button>
      {open && children}
    </>
  );
}

interface StepperSettingProps {
  label: string;
  description?: string | undefined;
  value: number;
  unit: string;
  range: Range;
  step: number;
  onChange: (value: number) => void;
}

/**
 * A number set by pressing rather than typing.
 *
 * Every number in this pane used to be a field to type into, which is the right
 * control for a panel width and the wrong one for "twenty-five minutes": nobody
 * types a session length, they nudge it. The value is clamped at the ends, so
 * the buttons simply stop.
 */
function StepperSetting({
  label,
  description,
  value,
  unit,
  range,
  step,
  onChange,
}: StepperSettingProps) {
  const set = (next: number) => {
    const clamped = Math.min(Math.max(next, range.min), range.max);
    if (clamped !== value) {
      onChange(clamped);
    }
  };
  return (
    <div className={styles.row} role="group" aria-label={label}>
      <Label text={label} description={description} />
      <span className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          aria-label={`${label}: less`}
          disabled={value <= range.min}
          onClick={() => {
            set(value - step);
          }}
        >
          <Minus size={12} strokeWidth={2.5} />
        </button>
        <output className={styles.stepValue}>
          {value} {unit}
        </output>
        <button
          type="button"
          className={styles.step}
          aria-label={`${label}: more`}
          disabled={value >= range.max}
          onClick={() => {
            set(value + step);
          }}
        >
          <Plus size={12} strokeWidth={2.5} />
        </button>
      </span>
    </div>
  );
}

const THEMES: Choice<Settings["theme"]>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const OPEN_ON: Choice<Settings["dock.openOn"]>[] = [
  { value: "hover", label: "On hover" },
  { value: "click", label: "On click" },
];

const TAB_APPEARANCE: Choice<Settings["tab.appearance"]>[] = [
  { value: "translucent", label: "Translucent" },
  { value: "solid", label: "Solid" },
];

const TAB_SIZES: Choice<Settings["tab.size"]>[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

/**
 * Where everything public about the app lives; `open_url` allows http and https
 * only.
 *
 * All three are on the published site or the public repository it is served
 * from, never on the source repository: that one is private, and a link from
 * inside the app that nobody outside can open is worse than no link.
 */
const DOWNLOADS_URL = "https://prasenjithiwale.github.io/edge-notes-apt/";
const CHANGELOG_URL = "https://prasenjithiwale.github.io/edge-notes-apt/changelog.html";
const ISSUES_URL = "https://github.com/prasenjithiwale/edge-notes-apt/issues";

/** How long the copy button says so before going back to "Copy". */
const COPIED_MS = 1_400;

/**
 * The app's details as one block of text, for pasting into a bug report. Plain
 * lines rather than JSON: it is going into a message to a person.
 */
function detailsFor(info: AppInfo): string {
  return [
    `${info.name} ${info.version}`,
    `${info.os} ${info.arch}`,
    `Data: ${info.dataDir}`,
  ].join("\n");
}

/**
 * Idea 6: check for a new version, and install it. Rust checks daily on its
 * own; this row says what it found, and lets someone ask now. A copy that
 * cannot update itself — a `.deb`, which apt updates — says so instead of
 * offering a button that would only fail.
 */
function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<"checking" | "downloading" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void updateStatus()
      .then(setStatus)
      .catch((error: unknown) => {
        console.error("settings: could not read the update status", error);
      });
    const unlisten = onUpdateAvailable((found) => {
      setStatus((current) => current && { ...current, found });
    });
    return () => {
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  if (status === null) {
    return null;
  }
  if (status.unavailable !== null) {
    return (
      <div className={styles.row}>
        <Label text="Updates" description={status.unavailable} />
      </div>
    );
  }
  if (status.found !== null) {
    return (
      <div className={styles.row}>
        <Label
          text={`Version ${status.found.version} is available`}
          description={note ?? "Your notes are saved, then Ledge restarts."}
        />
        <button
          type="button"
          className={styles.action}
          disabled={busy !== null}
          onClick={() => {
            setBusy("downloading");
            setNote(null);
            void updateInstall().catch((error: unknown) => {
              console.error("settings: the update failed", error);
              setNote("The download failed. Try again later.");
              setBusy(null);
            });
          }}
        >
          {busy === "downloading" ? "Downloading…" : "Install"}
        </button>
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <Label text="Updates" description={note ?? "Checked once a day."} />
      <button
        type="button"
        className={styles.action}
        disabled={busy !== null}
        onClick={() => {
          setBusy("checking");
          setNote(null);
          void updateCheck()
            .then((found) => {
              if (found === null) {
                setNote("Ledge is up to date.");
              } else {
                setStatus({ ...status, found });
              }
            })
            .catch((error: unknown) => {
              console.error("settings: the update check failed", error);
              setNote("Could not reach the update server.");
            })
            .finally(() => {
              setBusy(null);
            });
        }}
      >
        {busy === "checking" ? "Checking…" : "Check"}
      </button>
    </div>
  );
}

const SIDES: Choice<Settings["dock.side"]>[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/**
 * The panel's own colour, picked from the note palette.
 *
 * The palette rather than a second set of colours: it is the one list of
 * colours in the app, and what it is paired with — each colour's ink — is
 * contrast-checked against it in both themes, so chrome wearing the pair is
 * legible by construction. "No colour" is the neutral chrome of brief 7.1, and
 * the default; the whole row is the same dots the notes are filtered by.
 */
function AccentSetting({
  value,
  onChange,
}: {
  value: NoteColor;
  onChange: (accent: NoteColor) => void;
}) {
  return (
    <div className={styles.row}>
      <Label
        text="Panel colour"
        description="Tints the header, the toolbar and the focus ring."
      />
      <div className={styles.swatches} role="group" aria-label="Panel colour">
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={cx(styles.swatch, value === color && styles.swatchOn)}
            style={
              color === "none"
                ? undefined
                : ({ "--swatch": `var(--note-${color}-bg)` } as CSSProperties)
            }
            aria-label={colorName(color)}
            aria-pressed={value === color}
            title={colorName(color)}
            onClick={() => {
              onChange(color);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Which global shortcut a row sets. Mirrors `tray::Global` on the Rust side. */
type ShortcutName = "newNote" | "quickCapture" | "clipboardNote";

/**
 * The three global shortcuts, in the order they are used: the panel first, then
 * the two that never open it. Adding one is adding an entry here and a variant
 * to `tray::Global`.
 */
const SHORTCUTS: {
  which: ShortcutName;
  key: "shortcut.newNote" | "shortcut.quickCapture" | "shortcut.clipboardNote";
  label: string;
  description?: string;
}[] = [
  { which: "newNote", key: "shortcut.newNote", label: "New note shortcut" },
  {
    which: "quickCapture",
    key: "shortcut.quickCapture",
    label: "Quick capture",
    description: "One line to write into, without opening the panel.",
  },
  {
    which: "clipboardNote",
    key: "shortcut.clipboardNote",
    label: "Capture the clipboard",
    description: "The same line, with whatever you last copied already in it.",
  },
];

/** Brief M4: a small settings view inside the panel. */
export function SettingsView({ onClose }: SettingsViewProps) {
  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const apply = useSettingsStore((state) => state.apply);
  const setLock = useDockStore((state) => state.setLock);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [shortcutError, setShortcutError] = useState<{
    which: ShortcutName;
    message: string;
  } | null>(null);
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [about, setAbout] = useState<AppInfo | null>(null);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void monitorsList().then(setMonitors);
    void securityStatus()
      .then(setSecurity)
      .catch((error: unknown) => {
        // Same rule as About: a capability that cannot be read is not claimed.
        console.error("settings: could not read the security status", error);
      });
    void appInfo()
      .then(setAbout)
      .catch((error: unknown) => {
        // The pane is still worth showing without it; the section hides itself.
        console.error("settings: could not read the app details", error);
      });
    // Launch at login is read from the OS, which is the only honest source: the
    // login item can be removed from System Settings without telling the app.
    void autostartGet()
      .then(setAutostart)
      .catch((error: unknown) => {
        console.error("settings: could not read launch at login", error);
      });
  }, []);

  // Same rule as the editor and the search field: a focused text field holds the
  // panel open (brief 6.3), derived from state so it cannot be lost.
  useEffect(() => {
    setLock("settings", focused);
    return () => {
      setLock("settings", false);
    };
  }, [focused, setLock]);

  const fieldProps = {
    onFocus: () => {
      setFocused(true);
    },
    onBlur: () => {
      setFocused(false);
    },
  };

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <IconButton label="Back to notes" onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <h2 className={styles.heading}>Settings</h2>
      </div>

      <Group title="Appearance">
        <AccentSetting
          value={settings["appearance.accent"]}
          onChange={(accent) => {
            void patch({ "appearance.accent": accent });
          }}
        />

        <SegmentedSetting
          legend="Theme"
          choices={THEMES}
          value={settings.theme}
          onChange={(theme) => {
            void patch({ theme });
          }}
        />

        <SegmentedSetting
          legend="Tab"
          description="How the tab at the screen edge is painted while the panel is away."
          choices={TAB_APPEARANCE}
          value={settings["tab.appearance"]}
          onChange={(appearance) => {
            void patch({ "tab.appearance": appearance });
          }}
        />

        <SegmentedSetting
          legend="Tab size"
          description="How big the tab at the screen edge is, and how easy it is to hit."
          choices={TAB_SIZES}
          value={settings["tab.size"]}
          onChange={(size) => {
            // Shown at once, then stored: the tab is on screen while you choose,
            // so waiting for the round trip would make the choice feel dead.
            applyTabSize(size);
            void patch({ "tab.size": size });
          }}
        />

        <SliderSetting
          label="Panel translucency"
          value={settings["panel.translucency"]}
          range={PANEL_TRANSLUCENCY}
          step={5}
          onPreview={applyPanelTranslucency}
          onCommit={(value) => {
            void patch({ "panel.translucency": value });
          }}
        />
      </Group>

      <Group title="Dock">
        <SegmentedSetting
          legend="Screen edge"
          choices={SIDES}
          value={settings["dock.side"]}
          onChange={(side) => {
            void patch({ "dock.side": side });
          }}
        />

        <SegmentedSetting
          legend="Open panel"
          description="Point at the tab and wait, or click it."
          choices={OPEN_ON}
          value={settings["dock.openOn"]}
          onChange={(openOn) => {
            void patch({ "dock.openOn": openOn });
          }}
        />

        <label className={styles.row}>
          <Label text="Monitor" />
          <select
            className={styles.select}
            value={settings["dock.monitor"]}
            {...fieldProps}
            onChange={(event) => {
              void patch({ "dock.monitor": event.target.value });
            }}
          >
            <option value="primary">Primary</option>
            {monitors.map((monitor) => (
              <option key={monitor} value={monitor}>
                {monitor}
              </option>
            ))}
          </select>
        </label>

        <Advanced>
          <NumberSetting
            label="Open delay"
            // Hover intent only: a click opens the panel straight away.
            disabled={settings["dock.openOn"] === "click"}
            unit="ms"
            value={settings["dock.openDelayMs"]}
            range={DELAY.open}
            step={10}
            onCommit={(value) => {
              void patch({ "dock.openDelayMs": value });
            }}
            {...fieldProps}
          />

          <NumberSetting
            label="Close delay"
            unit="ms"
            value={settings["dock.closeDelayMs"]}
            range={DELAY.close}
            step={50}
            onCommit={(value) => {
              void patch({ "dock.closeDelayMs": value });
            }}
            {...fieldProps}
          />

          <NumberSetting
            label="Panel width"
            unit="px"
            value={settings["panel.width"]}
            range={PANEL_WIDTH}
            step={10}
            onCommit={(value) => {
              void patch({ "panel.width": value });
            }}
            {...fieldProps}
          />
        </Advanced>
      </Group>

      <Group title="Focus">
        <StepperSetting
          label="Session"
          value={settings["focus.focusMinutes"]}
          unit="min"
          range={FOCUS_MINUTES}
          step={5}
          onChange={(value) => {
            void patch({ "focus.focusMinutes": value });
          }}
        />

        <StepperSetting
          label="Short break"
          value={settings["focus.breakMinutes"]}
          unit="min"
          range={FOCUS_MINUTES}
          step={1}
          onChange={(value) => {
            void patch({ "focus.breakMinutes": value });
          }}
        />

        <StepperSetting
          label="Long break"
          value={settings["focus.longBreakMinutes"]}
          unit="min"
          range={FOCUS_MINUTES}
          step={5}
          onChange={(value) => {
            void patch({ "focus.longBreakMinutes": value });
          }}
        />

        <StepperSetting
          label="Long break after"
          description="Sessions before the longer one."
          value={settings["focus.longBreakEvery"]}
          unit="sessions"
          range={LONG_BREAK_EVERY}
          step={1}
          onChange={(value) => {
            void patch({ "focus.longBreakEvery": value });
          }}
        />

        <SwitchSetting
          label="Start the next phase"
          description="Begin the break, and the session after it, without being asked."
          checked={settings["focus.autoStart"]}
          onChange={(checked) => {
            void patch({ "focus.autoStart": checked });
          }}
          {...fieldProps}
        />
      </Group>

      {security !== null && (
        <Group title="Privacy">
          {security.captureProtection && (
            <SwitchSetting
              label="Hide from screen sharing"
              description="Keep the panel out of screen shares, recordings and screenshots."
              checked={settings["privacy.hideFromCapture"]}
              onChange={(checked) => {
                void patch({ "privacy.hideFromCapture": checked });
              }}
              {...fieldProps}
            />
          )}

          <div className={styles.row}>
            <Label
              text="Notes on disk"
              description={
                security.protection === "on"
                  ? "Encrypted. The key is in this system's keychain."
                  : `Not encrypted: ${security.detail}.`
              }
            />
          </div>

          {/* Only worth showing while there is a key to show: it is what gets
              the notes back on another machine, or after a keychain is reset. */}
          {security.protection === "on" && (
            <div className={styles.row}>
              <Label
                text="Recovery key"
                description={
                  recoveryKey === null
                    ? "Keep this somewhere safe. Without it, a lost keychain means lost notes."
                    : undefined
                }
              />
              {recoveryKey === null ? (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    void securityRecoveryKey()
                      .then(setRecoveryKey)
                      .catch((error: unknown) => {
                        console.error("settings: could not read the recovery key", error);
                      });
                  }}
                >
                  Reveal
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    void copyText(recoveryKey).then((ok) => {
                      setCopiedKey(ok);
                    });
                  }}
                >
                  {copiedKey ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          )}

          {recoveryKey !== null && (
            <div className={styles.row}>
              <code className={styles.recovery}>{recoveryKey}</code>
            </div>
          )}
        </Group>
      )}

      <Group title="General">
        <SwitchSetting
          label="Keep my order"
          description="Notes stay where they are dragged, instead of the most recently edited first."
          checked={settings["notes.manualOrder"]}
          onChange={(checked) => {
            void patch({ "notes.manualOrder": checked }).then(() => {
              // The list is sorted in the store as well as in SQL, so it has to
              // be asked again — nothing else would tell it the rule changed.
              void useNotesStore.getState().load();
            });
          }}
          {...fieldProps}
        />

        <SwitchSetting
          label="Task reminders"
          description="A notification when a task falls due."
          checked={settings["tasks.reminders"]}
          onChange={(checked) => {
            void patch({ "tasks.reminders": checked });
          }}
          {...fieldProps}
        />

        <SwitchSetting
          label="Launch at login"
          checked={autostart ?? false}
          onChange={(checked) => {
            // The OS is asked, and what it reports afterwards is what is shown:
            // a switch that moves on its own is better than one that lies.
            void autostartSet(checked)
              .then(setAutostart)
              .catch((error: unknown) => {
                console.error("settings: could not set launch at login", error);
                void autostartGet().then(setAutostart);
              });
          }}
          {...fieldProps}
        />

        {SHORTCUTS.map((shortcut) => (
          <ShortcutSetting
            key={shortcut.which}
            which={shortcut.which}
            label={shortcut.label}
            description={shortcut.description}
            accelerator={settings[shortcut.key]}
            error={shortcutError?.which === shortcut.which ? shortcutError.message : null}
            onRecord={(accelerator) => {
              setShortcutError(null);
              void shortcutSet(shortcut.which, accelerator)
                .then(apply)
                .catch((error: unknown) => {
                  setShortcutError({
                    which: shortcut.which,
                    message: isIpcErrorOf(error, "shortcut_unavailable")
                      ? "Another app is using that shortcut. The old one is still set."
                      : "That shortcut could not be set.",
                  });
                });
            }}
            {...fieldProps}
          />
        ))}

        <div className={styles.row}>
          <Label text="Notes as text files" description={exportedTo ?? undefined} />
          <button
            type="button"
            className={styles.action}
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void notesExport()
                .then((path) => {
                  setExportedTo(`Saved to ${path}`);
                })
                .catch((error: unknown) => {
                  console.error("settings: export failed", error);
                  setExportedTo(null);
                })
                .finally(() => {
                  setExporting(false);
                });
            }}
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </Group>

      {/* Last, because it is the one section you read rather than change. Left
          out entirely if Rust could not answer: a version box that says
          "unknown" is worse than no version box. */}
      {about !== null && (
        <Group title="About">
          <div className={styles.row}>
            <Label text={about.name} description="Notes on the edge of your screen" />
            <span className={styles.version}>{about.version}</span>
          </div>

          <UpdateRow />

          <div className={styles.row}>
            <Label text="System" />
            <span className={styles.value}>
              {about.os} · {about.arch}
            </span>
          </div>

          {/* People do ask where their notes are, and the answer is a path. */}
          <div className={styles.row}>
            <Label text="Notes are stored in" description={about.dataDir} />
          </div>

          <div className={styles.row}>
            <Label
              text="Details for a bug report"
              description="Version, system and where the notes are."
            />
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                void copyText(detailsFor(about)).then((ok) => {
                  if (!ok) {
                    return;
                  }
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, COPIED_MS);
                });
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className={styles.row}>
            <Label text="Downloads" description="New versions, for every platform." />
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                void openUrl(DOWNLOADS_URL);
              }}
            >
              Open
            </button>
          </div>

          <div className={styles.row}>
            <Label
              text="What is new"
              description="Every release, and what changed in it."
            />
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                void openUrl(CHANGELOG_URL);
              }}
            >
              Open
            </button>
          </div>

          {/* Under the copy button on purpose: copy the details, then open the
              place they are pasted. */}
          <div className={styles.row}>
            <Label
              text="Report a problem"
              description="Say what happened, with the details above."
            />
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                void openUrl(ISSUES_URL);
              }}
            >
              Open
            </button>
          </div>
        </Group>
      )}
    </div>
  );
}
