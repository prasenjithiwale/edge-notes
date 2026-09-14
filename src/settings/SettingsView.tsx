import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { IconButton } from "../components/IconButton";
import { monitorsList, notesExport, type Settings } from "../lib/ipc";
import { useDockStore } from "../store/dock";
import { useSettingsStore } from "../store/settings";
import styles from "./SettingsView.module.css";
import { PANEL_WIDTH, DELAY, clampSetting, type Range } from "./limits";

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
      <span className={styles.label}>{label}</span>
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
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of mutually exclusive buttons, like a native segmented control. */
function SegmentedSetting<T extends string>({
  legend,
  choices,
  value,
  onChange,
}: SegmentedSettingProps<T>) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
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
    </fieldset>
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

/** Brief M4: a small settings view inside the panel. */
export function SettingsView({ onClose }: SettingsViewProps) {
  const settings = useSettingsStore((state) => state.settings);
  const patch = useSettingsStore((state) => state.patch);
  const setLock = useDockStore((state) => state.setLock);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState(
    settings["shortcut.newNote"],
  );
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void monitorsList().then(setMonitors);
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

      <div className={styles.fields}>
        <SegmentedSetting
          legend="Theme"
          choices={THEMES}
          value={settings.theme}
          onChange={(theme) => {
            void patch({ theme });
          }}
        />

        <SegmentedSetting
          legend="Open panel"
          choices={OPEN_ON}
          value={settings["dock.openOn"]}
          onChange={(openOn) => {
            void patch({ "dock.openOn": openOn });
          }}
        />

        <SegmentedSetting
          legend="Tab"
          choices={TAB_APPEARANCE}
          value={settings["tab.appearance"]}
          onChange={(appearance) => {
            void patch({ "tab.appearance": appearance });
          }}
        />

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

        <label className={styles.row}>
          <span className={styles.label}>Monitor</span>
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

        <label className={styles.row}>
          <span className={styles.label}>New note shortcut</span>
          <input
            type="text"
            className={styles.text}
            value={shortcutDraft}
            spellCheck={false}
            autoComplete="off"
            onFocus={() => {
              setFocused(true);
            }}
            onChange={(event) => {
              setShortcutDraft(event.target.value);
            }}
            onBlur={() => {
              setFocused(false);
              // Rebinding on every keystroke would try to register "C", "Cm",
              // "Cmd"... and log a failure for each.
              if (shortcutDraft !== settings["shortcut.newNote"]) {
                void patch({ "shortcut.newNote": shortcutDraft });
              }
            }}
          />
        </label>
        <div className={styles.row}>
          <span className={styles.label}>Export notes</span>
          <button
            type="button"
            className={styles.action}
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              void notesExport()
                .then((path) => {
                  setExportedTo(path);
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
        {exportedTo !== null && (
          // Where the notes went, since nothing was asked and no folder opened.
          <p className={styles.note} role="status">
            Saved to {exportedTo}
          </p>
        )}
      </div>
    </div>
  );
}
