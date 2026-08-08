import { useState, useEffect, useRef, useMemo } from "react";
import { monthCode, shiftMonth, MONTH_NAMES } from "../../lib/dates";
import { IconChevD } from "../ui/Icons";

// MonthDropdown — 3 years back, 1 year forward (37 items).
// The months array is anchored to the current month (always at index ANCHOR).
const MONTH_WINDOW_BACK = 24;
const MONTH_WINDOW_FWD = 12;

export function MonthDropdown({
  month,
  setMonth,
  disabled = false,
}: {
  month: string;
  setMonth: (m: string) => void;
  disabled?: boolean;
}) {
  // Stable list — only recomputed when the selected month changes.
  const months = useMemo(
    () =>
      Array.from(
        { length: MONTH_WINDOW_BACK + MONTH_WINDOW_FWD + 1 },
        (_, i) => shiftMonth(month, i - MONTH_WINDOW_BACK)
      ),
    [month]
  );
  const ANCHOR = MONTH_WINDOW_BACK;

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(ANCHOR);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // After a keyboard-triggered scroll, ignore mouseEnter briefly so the list
  // scrolling under the pointer doesn't hijack the cursor position.
  const suppressMouse = useRef(false);
  const suppressTimer = useRef<number | undefined>(undefined);

  function scrollToIdx(idx: number, behavior: ScrollBehavior = "auto") {
    itemRefs.current[idx]?.scrollIntoView({ block: "nearest", behavior });
    suppressMouse.current = true;
    clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => {
      suppressMouse.current = false;
    }, 200);
  }

  // On open: reset cursor and scroll current month into the centre of the list.
  useEffect(() => {
    if (!open) return;
    setCursor(ANCHOR);
    requestAnimationFrame(() => {
      itemRefs.current[ANCHOR]?.scrollIntoView({ block: "center" });
    });
  }, [open, ANCHOR]);

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => {
        const next = Math.min(c + 1, months.length - 1);
        scrollToIdx(next);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => {
        const prev = Math.max(c - 1, 0);
        scrollToIdx(prev);
        return prev;
      });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setMonth(months[cursor]);
      setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        className="btn btn-soft"
        style={{ padding: "7px 10px" }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <IconChevD size={15} />
      </button>
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="card"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 11,
              width: 170,
              maxHeight: 280,
              overflowY: "auto",
              boxShadow: "var(--sh-lg)",
              padding: 5,
            }}
          >
            {months.map((m, i) => {
              const isCursor = i === cursor;
              const isCurrent = m === month;
              return (
                <button
                  key={m}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => {
                    setMonth(m);
                    setOpen(false);
                  }}
                  onMouseEnter={() => {
                    if (!suppressMouse.current) setCursor(i);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    border: "none",
                    background: isCursor
                      ? "var(--accent-soft)"
                      : isCurrent
                        ? "var(--surface-2)"
                        : "none",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13.5,
                    color:
                      isCursor || isCurrent ? "var(--accent-ink)" : "var(--ink)",
                    fontWeight: isCurrent ? 600 : 500,
                    textAlign: "left",
                    outline: isCursor ? "2px solid var(--accent)" : "none",
                    outlineOffset: -2,
                  }}
                >
                  <span className="num">{monthCode(m)}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {MONTH_NAMES[+m.slice(5) - 1].slice(0, 3)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
