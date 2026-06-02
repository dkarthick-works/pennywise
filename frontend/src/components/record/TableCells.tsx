// Shared inline-editable table cells.
// All cells use local state so only the final value (on blur / commit)
// triggers an API mutation — not every keystroke.

import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from "react";

// ─── Amount ───────────────────────────────────────────────────────────────
// Displays formatted Indian number while not focused; parses and saves on blur.

export function AmountInput({
  value,
  onChange,
  onEnterCommit,
  placeholder = "—",
  align = "right",
}: {
  value: number;
  onChange: (n: number) => void;
  onEnterCommit?: (parsed: number) => void;
  placeholder?: string;
  align?: string;
}) {
  const fmt = (n: number) => (n ? n.toLocaleString("en-IN") : "");
  const [local, setLocal] = useState(fmt(value));
  const [focused, setFocused] = useState(false);

  // Sync from outside only when not actively editing
  useEffect(() => {
    if (!focused) setLocal(fmt(value));
  }, [value, focused]);

  function commit() {
    setFocused(false);
    const n = parseInt(local.replace(/[^0-9]/g, ""), 10);
    const parsed = isNaN(n) ? 0 : n;
    if (parsed !== value) onChange(parsed);
    setLocal(fmt(parsed)); // reformat
  }

  return (
    <input
      className="cell-input num"
      inputMode="numeric"
      style={{ textAlign: align as "left" | "right" }}
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const n = parseInt(local.replace(/[^0-9]/g, ""), 10);
          const parsed = isNaN(n) ? 0 : n;
          if (parsed !== value) onChange(parsed);
          setLocal(fmt(parsed));
          setFocused(false);
          onEnterCommit?.(parsed);
        }
      }}
    />
  );
}

// ─── Date ─────────────────────────────────────────────────────────────────
// Saves on blur so partial manual edits don't fire requests.

export function DateCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value ?? "");

  useEffect(() => setLocal(value ?? ""), [value]);

  return (
    <input
      type="date"
      className="cell-input num"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      style={{ color: local ? "var(--ink)" : "var(--ink-3)", minWidth: 142 }}
    />
  );
}

// ─── Plain category input (Essential / Flexible rows) ─────────────────────
// Saves on blur; shows current value instantly so edits feel responsive.

export function RowCategoryInput({
  value,
  onChange,
  placeholder = "Category",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => setLocal(value), [value]);

  return (
    <input
      className="cell-input"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

// ─── Category with Google-Sheets ghost autocomplete (Daily rows) ──────────
// onChange updates local display state (no API call).
// onCommit fires when the user leaves the field — the caller saves to server.

export function CategoryInput({
  value,
  onChange,
  onCommit,
  onSubmit,
  suggestions,
  placeholder = "Category",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  onSubmit?: () => void;
  suggestions: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const match = useMemo(() => {
    if (!value) return "";
    const v = value.toLowerCase();
    const hit = suggestions.find((s) => s.toLowerCase().startsWith(v) && s.toLowerCase() !== v);
    return hit ?? "";
  }, [value, suggestions]);

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (match && (e.key === "Tab" || e.key === "ArrowRight" || e.key === "Enter")) {
      if (e.key !== "Enter" || ref.current?.selectionStart === value.length) {
        e.preventDefault();
        onChange(match);
        return;
      }
    }
    // Enter with no pending ghost suggestion → submit the quick-add row
    if (e.key === "Enter" && !match && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      {focus && match && (
        <div
          className="cell-input"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, pointerEvents: "none", whiteSpace: "pre", overflow: "hidden" }}
        >
          <span style={{ visibility: "hidden" }}>{value}</span>
          <span style={{ color: "var(--ink-3)" }}>{match.slice(value.length)}</span>
        </div>
      )}
      <input
        ref={ref}
        className="cell-input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); onCommit?.(value); }}
        onKeyDown={onKey}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: "relative", background: "transparent" }}
      />
      {focus && match && (
        <span
          className="kbd muted hide-sm"
          style={{ position: "absolute", right: 6, fontSize: 10, background: "var(--surface-2)", padding: "1px 5px", borderRadius: 4 }}
        >
          Tab ⇥
        </span>
      )}
    </div>
  );
}
