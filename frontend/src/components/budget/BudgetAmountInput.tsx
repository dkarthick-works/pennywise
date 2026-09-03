import { useState, useEffect, useRef } from "react";
import {
  formatBudgetAmount,
  parseBudgetCommit,
  sanitizeBudgetDraft,
} from "../../lib/budgetAmount";

export function BudgetAmountInput({
  value,
  disabled = false,
  onCommit,
  "aria-label": ariaLabel,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (n: number) => void;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState(() => formatBudgetAmount(value));
  const [message, setMessage] = useState("");
  const skipBlur = useRef(false);
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setDraft(formatBudgetAmount(value));
    setMessage("");
  }, [value]);

  function commit() {
    const parsed = parseBudgetCommit(draft);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    setMessage("");
    setDraft(formatBudgetAmount(parsed.value));
    if (parsed.value === value) return;
    onCommit(parsed.value);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid var(--border)", borderRadius: 9, padding: "6px 10px", background: "var(--surface-2)" }}>
        <span className="muted num">₹</span>
        <input
          className="num"
          aria-label={ariaLabel}
          aria-invalid={message ? true : undefined}
          disabled={disabled}
          value={draft}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => {
            setDraft(sanitizeBudgetDraft(e.target.value));
            setMessage("");
          }}
          onBlur={() => {
            focused.current = false;
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              skipBlur.current = true;
              commit();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(formatBudgetAmount(value));
              setMessage("");
              skipBlur.current = true;
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          style={{ width: 90, border: "none", background: "transparent", outline: "none", fontSize: 14.5, fontWeight: 600, textAlign: "right", color: "var(--ink)" }}
        />
      </div>
      {message ? (
        <div className="muted" style={{ fontSize: 11.5, color: "var(--neg)", marginTop: 4 }}>{message}</div>
      ) : null}
    </div>
  );
}
