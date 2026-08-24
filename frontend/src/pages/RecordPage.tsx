import { useState, useEffect, useMemo, Fragment } from "react";
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  openMonth, getSettings, updateBudgets,
  createTxn, updateTxn, deleteTxn,
} from "../api/ledger";
import { inr } from "../lib/money";
import { budgetColor } from "../lib/money";
import { monthCode, shiftMonth, MONTH_NAMES, monthLabel, defaultDraftDate } from "../lib/dates";
import { settledCreditIds } from "../lib/txns";
import {
  invalidateMonthCaches,
  invalidateTransactionNameSuggestionSections,
  invalidateTransactionNameSuggestions,
} from "../lib/monthCaches";
import { StatusCell } from "../components/record/StatusCell";
import {
  StatusFilterHeader,
  availableStatuses,
  matchesStatusFilter,
  type StatusDisplay,
} from "../components/record/StatusFilter";
import { AmountInput, DateCell, RowCategoryInput, CategoryInput } from "../components/record/TableCells";
import { CopyLastMonthButton } from "../components/record/CopyLastMonthButton";
import { MonthDropdown } from "../components/record/MonthDropdown";
import {
  IconChevL, IconChevR, IconPlus, IconX, IconCheck, IconLock, IconArrowR, IconDownload,
  IconRecord, IconCreditCard, IconTrend, IconWallet, IconZap, IconDashboard,
} from "../components/ui/Icons";
import type { Transaction, Section, Budgets } from "../types";
import { preserveApiRowOrder, sortRowsByDateDesc } from "../lib/recordRowOrder";

// ─── Status legend ────────────────────────────────────────────────────────

function StatusLegend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "10px 14px", borderTop: "1px solid var(--border-2)", fontSize: 11.5, color: "var(--ink-3)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span className="chip" style={{ background: "var(--surface-2)", color: "var(--ink-3)" }}>Cash</span> paid now
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span className="chip chip-pending">● Credit</span> not paid yet
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span className="chip chip-paid"><IconCheck size={11} /> Settled</span> cleared later
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span className="chip chip-cc"><IconArrowR size={11} /> Settles</span> clears credits
      </span>
    </div>
  );
}

// ─── Quick-add CTA (first tile) ───────────────────────────────────────────

function QuickAddTile({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="card card-pad"
      onClick={onOpen}
      style={{
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 18,
        minHeight: 168,
        cursor: "pointer",
        transition: ".15s",
        border: "1.5px dashed var(--accent)",
        background: "var(--surface)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-md)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-sm)";
        (e.currentTarget as HTMLElement).style.transform = "none";
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: "var(--accent)", display: "flex",
              alignItems: "center", justifyContent: "center", flex: "none",
            }}
          >
            <IconZap size={18} style={{ color: "#fff" }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent)" }}>
            Fast path
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em", lineHeight: 1.15, color: "var(--accent-ink)" }}>
          Log any spend
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.4, maxWidth: "28ch" }}>
          One row for Bare Minimum, Subscriptions, Daily, or Income. No tile hopping.
        </p>
      </div>
      <span
        className="btn btn-primary"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          alignSelf: "stretch",
          padding: "9px 14px",
          pointerEvents: "none",
        }}
      >
        Quick add
        <IconChevR size={15} style={{ color: "#fff" }} />
      </span>
    </button>
  );
}

// ─── Tile overview card ───────────────────────────────────────────────────

interface TileMeta {
  label: string; color: string; iconBg: string; icon: ComponentType<{ size?: number }>;
  tag: string; unit: string; desc: string;
}
function TileCard({ meta, rows, budget, onOpen }: {
  meta: TileMeta; rows: Transaction[]; budget: number; onOpen: () => void;
}) {
  const inc = rows.filter((r) => r.kind !== "settlement");
  const spent = inc.reduce((s, r) => s + r.amount, 0);
  const ratio = budget ? spent / budget : 0;
  const filled = inc.filter((r) => r.amount > 0).length;
  const credits = rows.filter((r) => r.kind === "credit").length;
  return (
    <button
      className="card card-pad"
      onClick={onOpen}
      style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 0, cursor: "pointer", transition: ".15s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-md)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-sm)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 10, flex: "none",
              background: meta.iconBg, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: meta.color,
            }}
          >
            <meta.icon size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>{meta.label}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{meta.tag}</div>
          </div>
        </div>
      </div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{inr(spent)}</div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        of {inr(budget)} · {credits > 0 ? `${credits} on credit` : `${filled} ${meta.unit}`}
      </div>
      <div className="bar"><i style={{ width: `${Math.min(ratio * 100, 100)}%`, background: budgetColor(ratio) }} /></div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: budgetColor(ratio) }}>
          {ratio > 1
            ? `${Math.round(ratio)}× budget`
            : `${Math.round(ratio * 100)}% used`}
        </span>
        <span className="muted num">{inr(Math.max(budget - spent, 0))} left</span>
      </div>
      <div style={{ marginTop: 14, borderTop: "1px solid var(--border-2)", paddingTop: 10,
        display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600,
        color: "var(--ink-2)", pointerEvents: "none" }}>
        <span style={{ color: meta.color, display: "flex" }}><meta.icon size={13} /></span> View entries <IconChevR size={13} />
      </div>
    </button>
  );
}

// ─── Tile detail header (budget edit + back) ──────────────────────────────

function TileBudgetHead({ meta, spent, budget, onBudget, onBack }: {
  meta: TileMeta; spent: number; budget: number; onBudget: (v: number) => void; onBack: () => void;
}) {
  const ratio = budget ? spent / budget : 0;
  return (
    <div style={{ marginBottom: 18 }}>
      <button className="btn btn-soft" style={{ padding: "6px 12px", marginBottom: 16 }} onClick={onBack}>
        <IconChevL size={15} /> All tiles
      </button>
      <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span className="dot" style={{ background: meta.color, width: 10, height: 10 }} />
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>{meta.label}</h2>
          </div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{meta.desc}</p>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div className="stat-lbl" style={{ marginBottom: 3 }}>Incurred</div>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: budgetColor(ratio) }}>{inr(spent)}</div>
          </div>
          <div>
            <label className="stat-lbl" style={{ display: "block", marginBottom: 3 }}>Section budget</label>
            <div style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid var(--border)", borderRadius: 9, padding: "5px 9px", background: "var(--surface-2)" }}>
              <span className="muted num">₹</span>
              <input
                className="num"
                value={budget.toLocaleString("en-IN")}
                onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10); onBudget(isNaN(n) ? 0 : n); }}
                style={{ width: 80, border: "none", background: "transparent", outline: "none", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}
              />
            </div>
          </div>
          <div style={{ minWidth: 120 }}>
            <div className="bar" style={{ marginBottom: 6 }}><i style={{ width: `${Math.min(ratio * 100, 100)}%`, background: budgetColor(ratio) }} /></div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: budgetColor(ratio) }}>{Math.round(ratio * 100)}% of budget</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared table row mutations ───────────────────────────────────────────

function useRowMutations(month: string, section: Section) {
  const qc = useQueryClient();
  const upd = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Transaction> }) => updateTxn(id, patch),
    onSuccess: (updated, { patch }) => {
      invalidateMonthCaches(qc, month);
      const teachesName =
        Object.prototype.hasOwnProperty.call(patch, "category") ||
        Object.prototype.hasOwnProperty.call(patch, "section");
      if (teachesName) {
        invalidateTransactionNameSuggestionSections(qc, [section, updated.section]);
      }
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteTxn(id),
    onSuccess: () => invalidateMonthCaches(qc, month),
  });
  const add = useMutation({
    mutationFn: (t: Omit<Transaction, "id" | "settled">) => createTxn(t),
    onSuccess: (created) => {
      invalidateMonthCaches(qc, month);
      invalidateTransactionNameSuggestions(qc, created.section);
    },
  });
  return { upd, del, add };
}

// ─── Essential tile ───────────────────────────────────────────────────────

function EssentialTile({ rows, section, month, settledSet, templates, onCopyPendingChange }: {
  rows: Transaction[]; section: Section; month: string; settledSet: Set<string>; templates: string[];
  onCopyPendingChange: (pending: boolean) => void;
}) {
  const qc = useQueryClient();
  const { upd, del, add } = useRowMutations(month, section);
  const [statusFilter, setStatusFilter] = useState<Set<StatusDisplay>>(new Set());
  const statusOptions = useMemo(() => availableStatuses(rows, settledSet), [rows, settledSet]);
  const ordered = useMemo(() => preserveApiRowOrder(rows), [rows]);
  const visible = useMemo(
    () => ordered.filter((r) => matchesStatusFilter(r, statusFilter, settledSet)),
    [ordered, statusFilter, settledSet]
  );

  // Labels in templates that don't yet have a matching row in this section.
  const existingCats = new Set(rows.map((r) => r.category));
  const missing = templates.filter((label) => !existingCats.has(label));

  const loadMut = useMutation({
    mutationFn: () =>
      Promise.all(
        missing.map((label) =>
          createTxn({ section, category: label, amount: 0, date: `${month}-01`, kind: "cash" })
        )
      ),
    onSuccess: () => invalidateMonthCaches(qc, month),
  });

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width: 158 }}>Date</th>
            <th style={{ minWidth: 190 }}>Category</th>
            <th style={{ width: 130 }}>Amount (₹)</th>
            <StatusFilterHeader active={statusFilter} onChange={setStatusFilter} options={statusOptions} />
            <th style={{ width: 44 }} />
          </tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td><DateCell value={r.date} onChange={(v) => upd.mutate({ id: r.id, patch: { date: v } })} /></td>
                <td>
                  {r.kind === "settlement"
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)", fontSize: 13.5, padding: "6px 8px", fontStyle: "italic" }}>
                        <IconArrowR size={13} style={{ color: "var(--c-flexible)", flex: "none" }} />{r.category}
                      </span>
                    : <RowCategoryInput value={r.category} placeholder="e.g. Rent" onChange={(v) => upd.mutate({ id: r.id, patch: { category: v } })} />
                  }
                </td>
                <td><AmountInput value={r.amount} onChange={(v) => upd.mutate({ id: r.id, patch: { amount: v } })} /></td>
                <td><StatusCell row={r} section={section} month={month} settledSet={settledSet} /></td>
                <td><button className="x-btn" onClick={() => del.mutate(r.id)} aria-label="Remove"><IconX size={15} /></button></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "26px 0", fontSize: 13.5 }}>
                  {rows.length === 0
                    ? "No rows yet — add one or load from templates."
                    : "No rows match the status filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderTop: "1px solid var(--border-2)" }}>
        <button className="btn btn-soft" onClick={() => add.mutate({ section, category: "", amount: 0, date: `${month}-01`, kind: "cash" })}>
          <IconPlus size={15} /> Add row
        </button>
        {templates.length > 0 && (
          <button
            className="btn btn-soft"
            onClick={() => loadMut.mutate()}
            disabled={missing.length === 0 || loadMut.isPending}
            title={missing.length === 0 ? "All template rows are already present" : `Add ${missing.length} template row${missing.length > 1 ? "s" : ""}`}
          >
            <IconDownload size={15} />
            {loadMut.isPending
              ? "Loading…"
              : missing.length === 0
                ? "Templates up to date"
                : `Load from templates (${missing.length})`}
          </button>
        )}
        <CopyLastMonthButton
          section={section}
          month={month}
          currentTxns={rows}
          onPendingChange={onCopyPendingChange}
          onCopied={() => setStatusFilter(new Set())}
        />
      </div>
      <StatusLegend />
    </div>
  );
}

// ─── Flexible tile ────────────────────────────────────────────────────────

function FlexibleTile({ rows, section, month, settledSet, templates, onCopyPendingChange }: {
  rows: Transaction[]; section: Section; month: string; settledSet: Set<string>; templates: string[];
  onCopyPendingChange: (pending: boolean) => void;
}) {
  const qc = useQueryClient();
  const { upd, del, add } = useRowMutations(month, section);
  const [statusFilter, setStatusFilter] = useState<Set<StatusDisplay>>(new Set());
  const statusOptions = useMemo(() => availableStatuses(rows, settledSet), [rows, settledSet]);
  const ordered = useMemo(() => preserveApiRowOrder(rows), [rows]);
  const visible = useMemo(
    () => ordered.filter((r) => matchesStatusFilter(r, statusFilter, settledSet)),
    [ordered, statusFilter, settledSet]
  );

  const existingCats = new Set(rows.map((r) => r.category));
  const missing = templates.filter((label) => !existingCats.has(label));

  const loadMut = useMutation({
    mutationFn: () =>
      Promise.all(
        missing.map((label) =>
          createTxn({ section, category: label, amount: 0, date: `${month}-01`, kind: "cash" })
        )
      ),
    onSuccess: () => invalidateMonthCaches(qc, month),
  });

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width: 158 }}>Date</th>
            <th style={{ minWidth: 180 }}>Subscription</th>
            <th style={{ width: 130 }}>Amount (₹)</th>
            <StatusFilterHeader active={statusFilter} onChange={setStatusFilter} options={statusOptions} />
            <th style={{ width: 44 }} />
          </tr></thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td><DateCell value={r.date} onChange={(v) => upd.mutate({ id: r.id, patch: { date: v } })} /></td>
                <td>
                  {r.kind === "settlement"
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)", fontSize: 13.5, padding: "6px 8px", fontStyle: "italic" }}>
                        <IconArrowR size={13} style={{ color: "var(--c-flexible)", flex: "none" }} />{r.category}
                      </span>
                    : <RowCategoryInput value={r.category} placeholder="e.g. Netflix" onChange={(v) => upd.mutate({ id: r.id, patch: { category: v } })} />
                  }
                </td>
                <td><AmountInput value={r.amount} onChange={(v) => upd.mutate({ id: r.id, patch: { amount: v } })} /></td>
                <td><StatusCell row={r} section={section} month={month} settledSet={settledSet} /></td>
                <td><button className="x-btn" onClick={() => del.mutate(r.id)} aria-label="Remove"><IconX size={15} /></button></td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "26px 0", fontSize: 13.5 }}>
                  {rows.length === 0
                    ? "No rows yet — add one or load from templates."
                    : "No rows match the status filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderTop: "1px solid var(--border-2)" }}>
        <button className="btn btn-soft" onClick={() => add.mutate({ section, category: "", amount: 0, date: `${month}-01`, kind: "cash" })}>
          <IconPlus size={15} /> Add subscription
        </button>
        {templates.length > 0 && (
          <button
            className="btn btn-soft"
            onClick={() => loadMut.mutate()}
            disabled={missing.length === 0 || loadMut.isPending}
            title={missing.length === 0 ? "All template rows are already present" : `Add ${missing.length} template row${missing.length > 1 ? "s" : ""}`}
          >
            <IconDownload size={15} />
            {loadMut.isPending
              ? "Loading…"
              : missing.length === 0
                ? "Templates up to date"
                : `Load from templates (${missing.length})`}
          </button>
        )}
        <CopyLastMonthButton
          section={section}
          month={month}
          currentTxns={rows}
          onPendingChange={onCopyPendingChange}
          onCopied={() => setStatusFilter(new Set())}
        />
      </div>
      <StatusLegend />
    </div>
  );
}

// ─── Daily row — isolated component with local category state ─────────────
// Keeps category in local state so onChange only updates the ghost-autocomplete
// display; the server mutation fires only on blur (onCommit).

function dailyGroupLabel(d: string): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${parseInt(dd, 10)} ${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function DailyRow({ r, section, month, settledSet, upd, del }: {
  r: Transaction;
  section: Section;
  month: string;
  settledSet: Set<string>;
  upd: ReturnType<typeof useRowMutations>["upd"];
  del: ReturnType<typeof useRowMutations>["del"];
}) {
  const [cat, setCat] = useState(r.category);
  // Sync from server if another mutation changes this row
  useEffect(() => setCat(r.category), [r.category]);

  return (
    <tr>
      <td><DateCell value={r.date} onChange={(v) => upd.mutate({ id: r.id, patch: { date: v } })} /></td>
      <td>
        {r.kind === "settlement"
          ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-2)", fontSize: 13.5, padding: "6px 8px", fontStyle: "italic" }}>
              <IconArrowR size={13} style={{ color: "var(--c-flexible)", flex: "none" }} />{r.category}
            </span>
          : <CategoryInput
              value={cat}
              section="daily"
              onChange={setCat}
              onCommit={(v) => { if (v !== r.category) upd.mutate({ id: r.id, patch: { category: v } }); }}
            />
        }
      </td>
      <td><AmountInput value={r.amount} onChange={(v) => upd.mutate({ id: r.id, patch: { amount: v } })} /></td>
      <td><StatusCell row={r} section={section} month={month} settledSet={settledSet} /></td>
      <td><button className="x-btn" onClick={() => del.mutate(r.id)} aria-label="Remove"><IconX size={15} /></button></td>
    </tr>
  );
}

// ─── Daily tile ───────────────────────────────────────────────────────────

function DailyTile({ rows, section, month, settledSet }: {
  rows: Transaction[]; section: Section; month: string; settledSet: Set<string>;
}) {
  const { upd, del, add } = useRowMutations(month, section);
  const [statusFilter, setStatusFilter] = useState<Set<StatusDisplay>>(new Set());
  const statusOptions = useMemo(() => availableStatuses(rows, settledSet), [rows, settledSet]);
  const blank = { date: defaultDraftDate(month, rows.map((r) => r.date)), category: "", amount: 0 };
  const [draft, setDraft] = useState(blank);

  const sorted = useMemo(() => sortRowsByDateDesc(rows), [rows]);
  const visible = useMemo(
    () => sorted.filter((r) => matchesStatusFilter(r, statusFilter, settledSet)),
    [sorted, statusFilter, settledSet]
  );
  const dateGroups = useMemo(() => {
    const groups: { date: string; rows: Transaction[] }[] = [];
    for (const r of visible) {
      const last = groups[groups.length - 1];
      if (last?.date === r.date) last.rows.push(r);
      else groups.push({ date: r.date, rows: [r] });
    }
    return groups;
  }, [visible]);

  function commit() {
    if (!draft.category.trim() || !draft.amount) return;
    add.mutate(
      { section, category: draft.category.trim(), amount: draft.amount, date: draft.date || `${month}-01`, kind: "cash" },
      { onSuccess: () => setDraft((d) => ({ date: d.date, category: "", amount: 0 })) }
    );
  }

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width: 158 }}>Date</th>
            <th style={{ minWidth: 190 }}>Category</th>
            <th style={{ width: 130 }}>Amount (₹)</th>
            <StatusFilterHeader active={statusFilter} onChange={setStatusFilter} options={statusOptions} />
            <th style={{ width: 44 }} />
          </tr></thead>
          <tbody>
            {/* quick-add row */}
            <tr style={{ background: "var(--accent-soft)" }}>
              <td><DateCell value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} /></td>
              <td>
                <CategoryInput
                  value={draft.category}
                  section="daily"
                  placeholder="Type to add — e.g. Groceries"
                  onChange={(v) => setDraft({ ...draft, category: v })}
                  onSubmit={() => commit()}
                />
              </td>
              <td><AmountInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} placeholder="0"
                onEnterCommit={(parsed) => {
                  if (!draft.category.trim() || !parsed) return;
                  add.mutate(
                    { section, category: draft.category.trim(), amount: parsed, date: draft.date || `${month}-01`, kind: "cash" },
                    { onSuccess: () => setDraft((d) => ({ date: d.date, category: "", amount: 0 })) }
                  );
                }}
              /></td>
              <td><span className="muted" style={{ fontSize: 12 }}>cash</span></td>
              <td>
                <button
                  className="btn btn-primary"
                  style={{ width: 34, height: 30, padding: 0, borderRadius: 8 }}
                  onClick={commit}
                  aria-label="Add entry"
                >
                  <IconPlus size={16} />
                </button>
              </td>
            </tr>

            {dateGroups.map((group) => (
              <Fragment key={group.date}>
                <tr className="date-group-hdr">
                  <td colSpan={5}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{dailyGroupLabel(group.date)}</span>
                    <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                      {group.rows.length} {group.rows.length === 1 ? "entry" : "entries"}
                    </span>
                  </td>
                </tr>
                {group.rows.map((r) => (
                  <DailyRow
                    key={r.id}
                    r={r}
                    section={section}
                    month={month}
                    settledSet={settledSet}
                    upd={upd}
                    del={del}
                  />
                ))}
              </Fragment>
            ))}

            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "26px 0", fontSize: 13.5 }}>
                  {rows.length === 0
                    ? "No entries yet — add your first above."
                    : "No entries match the status filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-2)", fontSize: 12, color: "var(--ink-3)" }}>
        Tip — type at least 2 characters for suggestions, then use <span className="kbd">↑</span> <span className="kbd">↓</span> and <span className="kbd">Enter</span> to choose. New entries default to cash; tap the Status chip to flag Credit or a Settlement.
      </div>
    </div>
  );
}

// ─── Income tile ─────────────────────────────────────────────────────────
// Income is always cash received — no status picker, no credit/settlement.
// Functions like Daily: quick-add row at top, entries listed newest-first.

function IncomeTile({ rows, month, onCopyPendingChange }: {
  rows: Transaction[]; month: string; onCopyPendingChange: (pending: boolean) => void;
}) {
  const { upd, del, add } = useRowMutations(month, "income");
  const blank = { date: defaultDraftDate(month, rows.map((r) => r.date)), category: "", amount: 0 };
  const [draft, setDraft] = useState(blank);

  const sorted = sortRowsByDateDesc(rows);

  function commit() {
    if (!draft.category.trim() || !draft.amount) return;
    add.mutate(
      { section: "income", category: draft.category.trim(), amount: draft.amount, date: draft.date || `${month}-01`, kind: "cash" },
      { onSuccess: () => setDraft((d) => ({ date: d.date, category: "", amount: 0 })) }
    );
  }

  return (
    <div className="card" style={{ overflow: "visible" }}>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr>
            <th style={{ width: 158 }}>Date</th>
            <th style={{ minWidth: 190 }}>Source</th>
            <th style={{ width: 130 }}>Amount (₹)</th>
            <th style={{ width: 44 }} />
          </tr></thead>
          <tbody>
            {/* quick-add row */}
            <tr style={{ background: "oklch(0.955 0.035 155 / 0.4)" }}>
              <td><DateCell value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} /></td>
              <td>
                <CategoryInput
                  value={draft.category}
                  section="income"
                  placeholder="e.g. Salary, Freelance, Dividend"
                  onChange={(v) => setDraft({ ...draft, category: v })}
                  onSubmit={() => commit()}
                />
              </td>
              <td><AmountInput value={draft.amount} onChange={(v) => setDraft({ ...draft, amount: v })} placeholder="0"
                onEnterCommit={(parsed) => {
                  if (!draft.category.trim() || !parsed) return;
                  add.mutate(
                    { section: "income", category: draft.category.trim(), amount: parsed, date: draft.date || `${month}-01`, kind: "cash" },
                    { onSuccess: () => setDraft((d) => ({ date: d.date, category: "", amount: 0 })) }
                  );
                }}
              /></td>
              <td>
                <button
                  className="btn btn-primary"
                  style={{ width: 34, height: 30, padding: 0, borderRadius: 8, background: "var(--pos)" }}
                  onClick={commit}
                  aria-label="Add income"
                >
                  <IconPlus size={16} />
                </button>
              </td>
            </tr>

            {sorted.map((r) => (
              <tr key={r.id}>
                <td><DateCell value={r.date} onChange={(v) => upd.mutate({ id: r.id, patch: { date: v } })} /></td>
                <td><RowCategoryInput value={r.category} onChange={(v) => upd.mutate({ id: r.id, patch: { category: v } })} /></td>
                <td><AmountInput value={r.amount} onChange={(v) => upd.mutate({ id: r.id, patch: { amount: v } })} /></td>
                <td><button className="x-btn" onClick={() => del.mutate(r.id)} aria-label="Remove"><IconX size={15} /></button></td>
              </tr>
            ))}

            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: "26px 0", fontSize: 13.5 }}>
                  No income logged yet — add your first above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderTop: "1px solid var(--border-2)" }}>
        <CopyLastMonthButton
          section="income"
          month={month}
          currentTxns={rows}
          onPendingChange={onCopyPendingChange}
        />
      </div>
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-2)", fontSize: 12, color: "var(--ink-3)" }}>
        Tip — type at least 2 characters for suggestions, then use <span className="kbd">↑</span> <span className="kbd">↓</span> and <span className="kbd">Enter</span> to choose from past entries.
      </div>
    </div>
  );
}

// ─── Income tile overview card (no budget / progress bar) ────────────────

function IncomeTileCard({ meta, rows, onOpen }: { meta: TileMeta; rows: Transaction[]; onOpen: () => void }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <button
      className="card card-pad"
      onClick={onOpen}
      style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 0, cursor: "pointer", transition: ".15s" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-md)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--sh-sm)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 10, flex: "none",
            background: meta.iconBg, display: "flex",
            alignItems: "center", justifyContent: "center",
            color: meta.color,
          }}
        >
          <meta.icon size={18} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>{meta.label}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{meta.tag}</div>
        </div>
      </div>
      <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: total > 0 ? "var(--pos)" : "var(--ink)" }}>
        {inr(total)}
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4, marginBottom: 12 }}>
        received · {rows.length} {rows.length === 1 ? "entry" : "entries"}
      </div>
      <div className="bar" style={{ opacity: 0 }} />
      <div style={{ height: 16, marginTop: 8 }} />
      <div style={{ marginTop: 14, borderTop: "1px solid var(--border-2)", paddingTop: 10,
        display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600,
        color: "var(--pos)", pointerEvents: "none" }}>
        <IconTrend size={13} /> Great! Keep tracking <IconChevR size={13} />
      </div>
    </button>
  );
}

// ─── RecordPage ───────────────────────────────────────────────────────────

const META: Record<Section, TileMeta> = {
  essential: { label: "Bare Minimum",   color: "var(--c-essential)", icon: IconRecord,     iconBg: "var(--c-essential-soft, #fff3e0)", tag: "Mandatory monthly spend",   unit: "entries",     desc: "Rent, savings, EMIs — the non-negotiables. Rows clone into every new month." },
  flexible:  { label: "Subscriptions",  color: "var(--c-flexible)",  icon: IconCreditCard, iconBg: "var(--c-flexible-soft,  #e8f5e9)", tag: "Recurring flexible spend",  unit: "active",      desc: "Wifi, SaaS, domains. Mark each Cash, Credit, or a Settlement that clears credits." },
  daily:     { label: "Daily / Running",color: "var(--c-daily)",     icon: IconTrend,      iconBg: "var(--c-daily-soft,     #e3f2fd)", tag: "Fast everyday entry",       unit: "entries",     desc: "Friction-free logging. Default is cash — flag Credit or Settlement only when needed." },
  income:    { label: "Income",         color: "var(--pos)",         icon: IconWallet,     iconBg: "var(--pos-soft,         #e8f5e9)", tag: "Money coming in",           unit: "entries",     desc: "Log salary, freelance, dividends and any other income. Always recorded as cash received." },
};

export function RecordPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const navigate = useNavigate();
  const [tile, setTile] = useState<Section | null>(null);
  // Lifted from the tiles: while a "Copy last month" op is loading, confirming
  // or writing, month navigation is locked to avoid racing the open-month query.
  const [copyPending, setCopyPending] = useState(false);
  // Changing tiles unmounts the copy button, so drop any lock it still held.
  const selectTile = (t: Section | null) => { setCopyPending(false); setTile(t); };
  const qc = useQueryClient();

  // Open-month call seeds templates if needed and returns this month's txns.
  const { data: monthData, isLoading } = useQuery({
    queryKey: ["open-month", month],
    queryFn: () => openMonth(month),
  });

  // Full txn list is also available in the shared "txns" cache (for dashboard).
  // Keep them in sync: when openMonth succeeds, populate the txns cache.
  const txns = monthData?.transactions ?? [];
  const closed = monthData?.closed ?? false;
  const settledSet = settledCreditIds(txns);

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [budgets, setBudgets] = useState<Budgets | null>(null);
  const effectiveBudgets = budgets ?? settings?.budgets ?? { essential: 0, flexible: 0, daily: 0 };

  const budgetMut = useMutation({
    mutationFn: (b: Budgets) => updateBudgets(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  function saveBudget(section: Section, value: number) {
    const nb = { ...effectiveBudgets, [section]: value };
    setBudgets(nb);
    budgetMut.mutate(nb);
  }

  const rowsOf = (sec: Section) => txns.filter((t) => t.section === sec);
  const incSpent = (sec: Section) =>
    rowsOf(sec).filter((r) => r.kind !== "settlement").reduce((s, r) => s + r.amount, 0);

  if (isLoading) {
    return (
      <div className="content">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--ink-3)", fontSize: 14 }}>
          Loading {monthLabel(month)}…
        </div>
      </div>
    );
  }

  return (
    <div className="content fade-in">
      <div className="page-head">
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <h1 className="page-title">Record Expense</h1>
          <p className="page-sub">
            Log this month's money. One date per row — flag Credit when cash hasn't left, Settlement when it clears a credit.
          </p>
        </div>
      </div>

      {/* month row */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-soft"
            style={{ padding: "7px 10px" }}
            onClick={() => { setMonth(shiftMonth(month, -1)); selectTile(null); }}
            disabled={copyPending}
            aria-label="Previous month"
          >
            <IconChevL size={15} />
          </button>
          <span className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.01em", color: closed ? "var(--ink-3)" : "var(--ink)" }}>
            {monthCode(month)}
          </span>
          <button
            className="btn btn-soft"
            style={{ padding: "7px 10px" }}
            onClick={() => { setMonth(shiftMonth(month, 1)); selectTile(null); }}
            disabled={copyPending}
            aria-label="Next month"
          >
            <IconChevR size={15} />
          </button>
          <MonthDropdown month={month} setMonth={(m) => { setMonth(m); selectTile(null); }} disabled={copyPending} />
        </div>
      </div>

      {closed && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", marginBottom: 20, background: "var(--surface-2)", borderStyle: "dashed" }}>
          <IconLock size={15} style={{ color: "var(--ink-3)" }} />
          <span className="muted" style={{ fontSize: 13 }}>
            This month is marked closed for your records. You can still edit — it's a bookkeeping flag.
          </span>
        </div>
      )}

      {tile === null ? (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <QuickAddTile onOpen={() => navigate("/record/entry")} />
            {/* Expense tiles with budget tracking */}
            {(["essential", "flexible", "daily"] as const).map((sec) => (
              <TileCard
                key={sec}
                meta={META[sec]}
                rows={rowsOf(sec)}
                budget={effectiveBudgets[sec]}
                onOpen={() => selectTile(sec)}
              />
            ))}
            {/* Income tile — no budget, shows total received */}
            <IncomeTileCard
              meta={META.income}
              rows={rowsOf("income")}
              onOpen={() => selectTile("income")}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "auto", padding: "11px 18px" }}
              onClick={() => navigate(`/dashboard?month=${month}`)}
              aria-label="Go to dashboard"
            >
            <IconDashboard size={16} style={{ color: "#fff" }} /> Dashboard <IconChevR size={15} style={{ color: "#fff" }} />
            </button>
          </div>
        </>
      ) : (
        <div className="fade-in">
          {tile !== "income" && (
            <TileBudgetHead
              meta={META[tile]}
              spent={incSpent(tile)}
              budget={effectiveBudgets[tile as "essential" | "flexible" | "daily"]}
              onBudget={(v) => saveBudget(tile as "essential" | "flexible" | "daily", v)}
              onBack={() => selectTile(null)}
            />
          )}
          {tile === "income" && (
            <div style={{ marginBottom: 18 }}>
              <button className="btn btn-soft" style={{ padding: "6px 12px", marginBottom: 16 }} onClick={() => selectTile(null)}>
                <IconChevL size={15} /> All tiles
              </button>
              <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span className="dot" style={{ background: META.income.color, width: 10, height: 10 }} />
                    <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>Income</h2>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{META.income.desc}</p>
                </div>
                <div>
                  <div className="stat-lbl" style={{ marginBottom: 3 }}>Received this month</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, color: "var(--pos)" }}>
                    {inr(rowsOf("income").reduce((s, r) => s + r.amount, 0))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {tile === "essential" && (
            <EssentialTile rows={rowsOf("essential")} section="essential" month={month} settledSet={settledSet} templates={settings?.templates.essential ?? []} onCopyPendingChange={setCopyPending} />
          )}
          {tile === "flexible" && (
            <FlexibleTile rows={rowsOf("flexible")} section="flexible" month={month} settledSet={settledSet} templates={settings?.templates.flexible ?? []} onCopyPendingChange={setCopyPending} />
          )}
          {tile === "daily" && (
            <DailyTile rows={rowsOf("daily")} section="daily" month={month} settledSet={settledSet} />
          )}
          {tile === "income" && (
            <IncomeTile rows={rowsOf("income")} month={month} onCopyPendingChange={setCopyPending} />
          )}
        </div>
      )}
    </div>
  );
}
