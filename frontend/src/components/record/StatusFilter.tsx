// Column-header filter for transaction display status (cash / credit / settled / settlement).

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { IconArrowR, IconCheck } from "../ui/Icons";
import type { Transaction } from "../../types";

export type StatusDisplay = "cash" | "credit" | "settled" | "settlement";

export function rowDisplayStatus(row: Transaction, settledSet: Set<string>): StatusDisplay {
  if (row.kind === "settlement") return "settlement";
  if (row.kind === "credit") return settledSet.has(row.id) ? "settled" : "credit";
  return "cash";
}

export function availableStatuses(rows: Transaction[], settledSet: Set<string>): StatusDisplay[] {
  const seen = new Set<StatusDisplay>();
  const out: StatusDisplay[] = [];
  for (const r of rows) {
    const s = rowDisplayStatus(r, settledSet);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function matchesStatusFilter(
  row: Transaction,
  filter: Set<StatusDisplay>,
  settledSet: Set<string>
): boolean {
  if (filter.size === 0) return true;
  return filter.has(rowDisplayStatus(row, settledSet));
}

function StatusChip({ kind }: { kind: StatusDisplay }) {
  if (kind === "settlement") {
    return <span className="chip chip-cc"><IconArrowR size={11} /> Settlement</span>;
  }
  if (kind === "settled") {
    return <span className="chip chip-paid"><IconCheck size={11} /> Settled</span>;
  }
  if (kind === "credit") {
    return <span className="chip chip-pending">● Credit</span>;
  }
  return <span className="chip" style={{ background: "var(--surface-2)", color: "var(--ink-3)" }}>Cash</span>;
}

export function StatusFilterHeader({
  active,
  onChange,
  options,
}: {
  active: Set<StatusDisplay>;
  onChange: (next: Set<StatusDisplay>) => void;
  options: StatusDisplay[];
}) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{
    top: number | undefined;
    bottom: number | undefined;
    left: number;
    maxHeight: number;
  }>({ top: 0, bottom: undefined, left: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filtered = active.size > 0;

  function computePos() {
    const rect = triggerRef.current!.getBoundingClientRect();
    const margin = 8, gap = 6, dropWidth = 220;
    const left = Math.min(rect.left, window.innerWidth - dropWidth - margin);
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    if (spaceBelow >= spaceAbove) {
      return { left, top: rect.bottom + gap, bottom: undefined, maxHeight: spaceBelow - gap };
    }
    return { left, top: undefined, bottom: window.innerHeight - rect.top + gap, maxHeight: spaceAbove - gap };
  }

  function openDropdown() {
    if (!triggerRef.current) return;
    setDropPos(computePos());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onScroll() {
      if (!triggerRef.current) return;
      setDropPos(computePos());
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  function toggle(kind: StatusDisplay) {
    const next = new Set(active);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange(next);
  }

  const dropdown = open
    ? createPortal(
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div
            className="card"
            style={{
              position: "fixed",
              top: dropPos.top,
              bottom: dropPos.bottom,
              left: dropPos.left,
              maxHeight: dropPos.maxHeight,
              overflowY: "auto",
              zIndex: 31,
              width: 220,
              boxShadow: "var(--sh-lg)",
              padding: 7,
            }}
          >
            <div className="nav-label" style={{ padding: "4px 8px 6px" }}>Filter by status</div>
            {options.map((kind) => (
              <button
                key={kind}
                onClick={() => toggle(kind)}
                className="link-opt"
                data-on={active.has(kind) ? "1" : "0"}
              >
                <span className="lk-box">
                  {active.has(kind) && <IconCheck size={12} />}
                </span>
                <StatusChip kind={kind} />
              </button>
            ))}
            {filtered && (
              <button
                onClick={() => onChange(new Set())}
                className="btn btn-soft"
                style={{ width: "100%", marginTop: 6, justifyContent: "center", fontSize: 12.5 }}
              >
                Clear filter
              </button>
            )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <th style={{ width: 150 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>Status</span>
        {options.length > 1 && (
          <button
            ref={triggerRef}
            type="button"
            className="btn btn-soft"
            onClick={openDropdown}
            aria-label="Filter by status"
            aria-expanded={open}
            title="Filter by status"
            style={{
              width: 26,
              height: 24,
              padding: 0,
              borderRadius: 6,
              color: filtered ? "var(--accent-ink)" : "var(--ink-3)",
              background: filtered ? "var(--accent-soft)" : undefined,
            }}
          >
            <IconFilter size={14} />
          </button>
        )}
      </div>
      {dropdown}
    </th>
  );
}

function IconFilter({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}
