import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Minus, Plus } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { cx } from "../lib/cx";
import { acceleratorFromEvent, formatAccelerator } from "../lib/accelerator";
import {
  autostartGet,
  autostartSet,
  isIpcErrorOf,
  monitorsList,
  notesExport,
  shortcutSet,
  type Settings,
} from "../lib/ipc";
import { useDockStore } from "../store/dock";
import { applyPanelTranslucency, useSettingsStore } from "../store/settings";
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
        <span className={styles.labelWrap} id="shortcut-label">
          <span className={styles.label}>New note shortcut</span>
        </span>
        <button
          type="button"
          className={styles.recorder}
          aria-labelledby="shortcut-label"
          aria-describedby={message === null ? undefined : "shortcut-message"}
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
          {recording ? "Press a shortcut" : formatAccelerator(accelerator)}
        </button>
      </div>
      {message !== null && (
        <p
          id="shortcut-message"
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

const SIDES: Choice<Settings["dock.side"]>[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
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
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void monitorsList().then(setMonitors);
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

      <Group title="General">
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

        <ShortcutSetting
          accelerator={settings["shortcut.newNote"]}
          error={shortcutError}
          onRecord={(accelerator) => {
            setShortcutError(null);
            void shortcutSet(accelerator)
              .then(apply)
              .catch((error: unknown) => {
                setShortcutError(
                  isIpcErrorOf(error, "shortcut_unavailable")
                    ? "Another app is using that shortcut. The old one is still set."
                    : "That shortcut could not be set.",
                );
              });
          }}
          {...fieldProps}
        />

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
    </div>
  );
}
