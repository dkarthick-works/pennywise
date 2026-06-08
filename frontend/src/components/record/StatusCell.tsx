// Settlement status chip + dropdown (cash / credit / settlement + credit picker).
// The dropdown uses position:fixed + getBoundingClientRect so it escapes the
// overflowX:auto table wrapper and is never clipped.

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getOpenCredits, updateTxn } from "../../api/ledger";
import { inr } from "../../lib/money";
import { prettyDate } from "../../lib/dates";
import { IconArrowR, IconCheck } from "../ui/Icons";
import type { Transaction, TxnKind, Section } from "../../types";

interface Props {
  row: Transaction;
  section: Section;
  month: string;
  settledSet: Set<string>;
}

function settleShort(row: Transaction): string {
  const ids = row.settles ?? [];
  if (!ids.length) return "Pick credits";
  return ids.length > 1 ? `+${ids.length} credits` : "1 credit";
}

export function StatusCell({ row, section, month, settledSet }: Props) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState<{
    top: number | undefined;
    bottom: number | undefined;
    left: number;
    maxHeight: number;
  }>({ top: 0, bottom: undefined, left: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();
  const kind = row.kind;
  const settled = kind === "credit" && settledSet.has(row.id);

  const { data: candidates = [] } = useQuery({
    queryKey: ["open-credits", section, row.id],
    queryFn: () => getOpenCredits(section, row.id),
    enabled: open && kind === "settlement",
  });

  const mut = useMutation({
    mutationFn: (patch: Partial<Transaction>) => updateTxn(row.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["open-month", month] }),
  });

  // Position below the chip when there's room; flip above when there isn't.
  // Always cap maxHeight to the available space so the card fits + scrolls.
  function computePos() {
    const rect = triggerRef.current!.getBoundingClientRect();
    const margin = 8, gap = 6, dropWidth = 268;
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

  // Recalculate position on scroll so the dropdown tracks with the table.
  useEffect(() => {
    if (!open) return;
    function onScroll() {
      if (!triggerRef.current) return;
      setDropPos(computePos());
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

  function choose(k: TxnKind) {
    const patch: Partial<Transaction> = { kind: k };
    if (k !== "settlement") patch.settles = [];
    mut.mutate(patch);
    if (k !== "settlement") setOpen(false);
  }

  function toggleLink(credit: Transaction) {
    const cur = new Set(row.settles ?? []);
    cur.has(credit.id) ? cur.delete(credit.id) : cur.add(credit.id);
    const ids = [...cur];
    const sum = candidates
      .filter((c) => ids.includes(c.id))
      .reduce((s, c) => s + c.amount, 0);
    const cats = candidates.filter((c) => ids.includes(c.id)).map((c) => c.category);
    mut.mutate({
      settles: ids,
      amount: sum || row.amount,
      category: cats.length ? "Settles: " + cats.join(", ") : row.category,
    });
  }

  const linked = new Set(row.settles ?? []);

  let chip: React.ReactNode;
  if (kind === "settlement") {
    chip = <span className="chip chip-cc"><IconArrowR size={11} /> {settleShort(row)}</span>;
  } else if (settled) {
    chip = <span className="chip chip-paid"><IconCheck size={11} /> Settled</span>;
  } else if (kind === "credit") {
    chip = <span className="chip chip-pending">● Credit</span>;
  } else {
    chip = <span className="chip" style={{ background: "var(--surface-2)", color: "var(--ink-3)" }}>Cash</span>;
  }

  const dropdown = open
    ? createPortal(
        <>
          {/* backdrop */}
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          {/* dropdown — rendered at document root to escape all overflow containers */}
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
              width: 268,
              boxShadow: "var(--sh-lg)",
              padding: 7,
            }}
          >
            <div className="nav-label" style={{ padding: "4px 8px 6px" }}>Status</div>
            {([
              ["cash",       "Paid same day",     "Cash leaves now"],
              ["credit",     "Credit",            "Incurred, not paid yet"],
              ["settlement", "Credit settlement", "Pays off earlier credits"],
            ] as [TxnKind, string, string][]).map(([k, t, d]) => (
              <button
                key={k}
                onClick={() => choose(k)}
                className="status-opt"
                data-on={kind === k ? "1" : "0"}
              >
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{d}</span>
                </span>
                {kind === k && <IconCheck size={15} style={{ color: "var(--accent)" }} />}
              </button>
            ))}

            {kind === "settlement" && (
              <div style={{ borderTop: "1px solid var(--border-2)", marginTop: 6, paddingTop: 7 }}>
                <div className="nav-label" style={{ padding: "0 8px 4px" }}>Credits being settled</div>
                {candidates.length === 0 && (
                  <div className="muted" style={{ fontSize: 12.5, padding: "4px 8px 8px" }}>
                    No open credits in this section yet. Mark a row as Credit first.
                  </div>
                )}
                <div style={{ maxHeight: 168, overflowY: "auto" }}>
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggleLink(c)}
                      className="link-opt"
                      data-on={linked.has(c.id) ? "1" : "0"}
                    >
                      <span className="lk-box">
                        {linked.has(c.id) && <IconCheck size={12} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                        {c.category}
                      </span>
                      <span className="muted num" style={{ fontSize: 11 }}>{prettyDate(c.date)}</span>
                      <span className="num" style={{ fontSize: 12.5, fontWeight: 600 }}>{inr(c.amount)}</span>
                    </button>
                  ))}
                </div>
                {linked.size > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 8px 4px", fontSize: 12.5, borderTop: "1px solid var(--border-2)", marginTop: 5 }}>
                    <span className="muted">Auto-filled amount</span>
                    <span className="num" style={{ fontWeight: 700 }}>{inr(row.amount)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={openDropdown}
        style={{ border: "none", background: "none", padding: 0, cursor: "pointer", display: "inline-flex" }}
        title={settled ? "Settled by a later payment" : "Set status"}
      >
        {chip}
      </button>
      {dropdown}
    </div>
  );
}
