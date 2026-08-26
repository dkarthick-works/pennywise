import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { openMonth, createTxn, updateTxn, deleteTxn } from "../api/ledger";
import { monthCode, shiftMonth, monthLabel, monthKey, defaultDraftDate, shiftDateToMonth, prettyDate } from "../lib/dates";
import {
  invalidateMonthCaches,
  invalidateTransactionNameSuggestions,
  invalidateTransactionNameSuggestionSections,
} from "../lib/monthCaches";
import {
  KIND_LABEL,
  SECTION_LABEL,
  nextKind,
  nextSection,
} from "../lib/recordLabels";
import { AmountInput, DateCell, CategoryInput } from "../components/record/TableCells";
import { AiQuickAdd } from "../components/record/AiQuickAdd";
import { MonthDropdown } from "../components/record/MonthDropdown";
import { IconChevL, IconChevR, IconPlus, IconX } from "../components/ui/Icons";
import type { Transaction, Section, TxnKind } from "../types";

const NAME_PLACEHOLDER: Record<Section, string> = {
  essential: "e.g. Rent",
  flexible: "e.g. Netflix",
  daily: "e.g. Groceries",
  income: "e.g. Salary, Freelance",
};

const NAME_LABEL: Record<Section, string> = {
  essential: "Category",
  flexible: "Subscription",
  daily: "Category",
  income: "Source",
};

export function RecordEntryPage({
  month,
  setMonth,
}: {
  month: string;
  setMonth: (m: string) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [section, setSection] = useState<Section>("daily");
  const [kind, setKind] = useState<TxnKind>("cash");
  const [date, setDate] = useState(() => defaultDraftDate(month, []));
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState(0);
  const [formErr, setFormErr] = useState("");
  const [dateUnlocked, setDateUnlocked] = useState(false);
  const [sessionTransactions, setSessionTransactions] = useState<Transaction[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [rowErr, setRowErr] = useState("");
  const [localCategories, setLocalCategories] = useState<Record<string, string>>({});

  const dateTouchedRef = useRef(false);
  const nameFocusRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef(section);
  sectionRef.current = section;

  const { data: monthData, isLoading, isError, error } = useQuery({
    queryKey: ["open-month", month],
    queryFn: () => openMonth(month),
  });

  const effectiveKind: TxnKind = section === "income" ? "cash" : kind;

  // Guarded async date init from openMonth — never clobber a user-edited date.
  useEffect(() => {
    if (!monthData) return;
    if (dateTouchedRef.current) return;
    const dates = monthData.transactions.map((t) => t.date);
    setDate(defaultDraftDate(month, dates));
  }, [monthData, month]);

  function changeMonth(next: string) {
    setMonth(next);
    // Always keep date inside the selected month.
    setDate((prev) => {
      if (!dateTouchedRef.current) {
        // New month's openMonth may not be cached yet; shift then let effect refine.
        return shiftDateToMonth(prev, next);
      }
      return shiftDateToMonth(prev, next);
    });
  }

  function markDateTouched(next: string) {
    dateTouchedRef.current = true;
    setDate(next);
  }

  function cycleSection() {
    const next = nextSection(section);
    setSection(next);
    if (next === "income") setKind("cash");
  }

  function cycleKind() {
    if (section === "income") return;
    setKind(nextKind(kind));
  }

  // Alt+S / Alt+K — never bare S/K (would break typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.isComposing || e.keyCode === 229) return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        setSection((s) => {
          const next = nextSection(s);
          if (next === "income") setKind("cash");
          return next;
        });
      } else if (key === "k") {
        e.preventDefault();
        if (sectionRef.current === "income") return;
        setKind((k) => nextKind(k));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rememberCreated = useCallback(
    (created: Transaction) => {
      setSessionTransactions((prev) => [created, ...prev]);
      invalidateMonthCaches(qc, monthKey(created.date));
      invalidateTransactionNameSuggestions(qc, created.section);
    },
    [qc]
  );

  const create = useMutation({
    mutationFn: createTxn,
    onSuccess: (created) => {
      rememberCreated(created);
      setCategory("");
      setAmount(0);
      setFormErr("");
      requestAnimationFrame(() => {
        nameFocusRef.current?.querySelector("input")?.focus();
      });
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not save entry");
    },
  });

  const patchMut = useMutation({
    mutationFn: ({ id, p }: { id: string; p: Partial<Omit<Transaction, "id">> }) =>
      updateTxn(id, p),
    onSuccess: (updated, { id, p }) => {
      setPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setSessionTransactions((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      setLocalCategories((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErr("");
      invalidateMonthCaches(qc, monthKey(updated.date));
      const teachesName =
        Object.prototype.hasOwnProperty.call(p, "category") ||
        Object.prototype.hasOwnProperty.call(p, "section");
      if (teachesName) {
        invalidateTransactionNameSuggestionSections(qc, [
          (p as { section?: string }).section ?? updated.section,
          updated.section,
        ]);
      }
    },
    onError: (e: unknown, { id }) => {
      setPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setLocalCategories((prev) => { const next = { ...prev }; delete next[id]; return next; });
      setRowErr(e instanceof Error ? e.message : "Could not update entry");
    },
  });

  const removeMut = useMutation({
    mutationFn: ({ id }: { id: string; txnMonth: string }) => deleteTxn(id),
    onSuccess: (_, { id, txnMonth }) => {
      setPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setSessionTransactions((prev) => prev.filter((r) => r.id !== id));
      setRowErr("");
      invalidateMonthCaches(qc, txnMonth);
    },
    onError: (e: unknown, { id }) => {
      setPendingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setRowErr(e instanceof Error ? e.message : "Could not delete entry");
    },
  });

  function patchRow(id: string, p: Partial<Omit<Transaction, "id">>) {
    setRowErr("");
    setPendingIds((prev) => new Set([...prev, id]));
    patchMut.mutate({ id, p });
  }

  function removeRow(id: string, txnDate: string) {
    setRowErr("");
    setPendingIds((prev) => new Set([...prev, id]));
    removeMut.mutate({ id, txnMonth: monthKey(txnDate) });
  }

  const submit = useCallback(
    (opts?: { category?: string; amount?: number }) => {
      if (create.isPending) return;

      const name = (opts?.category ?? category).trim();
      const amt = opts?.amount ?? amount;

      setFormErr("");

      if (!name) {
        setFormErr("Name is required");
        return;
      }
      if (!amt || amt <= 0) {
        setFormErr("Amount must be greater than 0");
        return;
      }
      if (!date || monthKey(date) !== month) {
        setFormErr("Date must be in the selected month");
        return;
      }

      const body: Omit<Transaction, "id" | "settled"> = {
        section,
        category: name,
        amount: amt,
        date,
        kind: section === "income" ? "cash" : kind,
      };
      if (body.kind === "settlement") {
        body.settles = [];
      }

      create.mutate(body);
    },
    [amount, category, create, date, kind, month, section]
  );

  if (isLoading) {
    return (
      <div className="content">
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--ink-3)", fontSize: 14 }}>
          Loading {monthLabel(month)}…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="content fade-in">
        <button
          type="button"
          className="btn btn-soft"
          style={{ padding: "6px 12px", marginBottom: 16 }}
          onClick={() => navigate("/record")}
        >
          <IconChevL size={15} /> All tiles
        </button>
        <div className="card card-pad" style={{ color: "var(--neg)" }}>
          {error instanceof Error ? error.message : "Could not open month"}
        </div>
      </div>
    );
  }

  const pending = create.isPending;

  return (
    <div className="content fade-in">
      <button
        type="button"
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate("/record")}
        disabled={pending}
      >
        <IconChevL size={15} /> All tiles
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Quick add</h1>
          <p className="page-sub">
            Name → amount → Enter. Section and kind cycle with a tap (or Alt+S / Alt+K).
            Date sticks from the last entry in this month.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
          Open month
        </span>
        <button
          className="btn btn-soft"
          style={{ padding: "7px 10px" }}
          onClick={() => changeMonth(shiftMonth(month, -1))}
          disabled={pending}
          aria-label="Previous month"
        >
          <IconChevL size={15} />
        </button>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {monthCode(month)}
        </span>
        <button
          className="btn btn-soft"
          style={{ padding: "7px 10px" }}
          onClick={() => changeMonth(shiftMonth(month, 1))}
          disabled={pending}
          aria-label="Next month"
        >
          <IconChevR size={15} />
        </button>
        <MonthDropdown month={month} setMonth={changeMonth} disabled={pending} />
      </div>

      <AiQuickAdd month={month} onCreated={rememberCreated} />

      <div className="card" style={{ overflow: "visible", marginBottom: 20 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Section</th>
                <th style={{ width: 158 }}>Date</th>
                <th style={{ minWidth: 180 }}>{NAME_LABEL[section]}</th>
                <th style={{ width: 130 }}>Amount (₹)</th>
                <th style={{ width: 110 }}>Kind</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: "var(--accent-soft)" }}>
                <td>
                  <button
                    type="button"
                    className="chip"
                    aria-label={`Section ${SECTION_LABEL[section]}. Activate to cycle.`}
                    title={`${SECTION_LABEL[section]} — click or Alt+S to cycle`}
                    disabled={pending}
                    onClick={cycleSection}
                    style={{
                      background: "var(--accent)",
                      color: "var(--on-accent, #fff)",
                      fontWeight: 700,
                      border: "none",
                      cursor: pending ? "default" : "pointer",
                    }}
                  >
                    {SECTION_LABEL[section]}
                  </button>
                </td>
                <td>
                  {dateUnlocked ? (
                    <DateCell
                      value={date}
                      onChange={(v) => {
                        if (monthKey(v) !== month) {
                          setFormErr("Date must be in the selected month");
                          return;
                        }
                        setFormErr("");
                        markDateTouched(v);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="cell-input num"
                      disabled={pending}
                      onClick={() => setDateUnlocked(true)}
                      aria-label={`Date ${prettyDate(date)}. Activate to edit.`}
                      style={{
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        cursor: pending ? "default" : "pointer",
                        color: "var(--ink)",
                        width: "100%",
                      }}
                    >
                      {prettyDate(date)}
                      <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>sticky</span>
                    </button>
                  )}
                </td>
                <td>
                  <div ref={nameFocusRef}>
                    <CategoryInput
                      value={category}
                      section={section}
                      placeholder={NAME_PLACEHOLDER[section]}
                      autoFocus
                      onChange={setCategory}
                      onSubmit={(v) => submit({ category: v })}
                    />
                  </div>
                </td>
                <td>
                  <AmountInput
                    value={amount}
                    onChange={(n) => setAmount(n ?? 0)}
                    placeholder="0"
                    immediate
                    onEnterCommit={(parsed) => submit({ amount: parsed ?? 0 })}
                  />
                </td>
                <td>
                  {section === "income" ? (
                    <span className="muted" style={{ fontSize: 12 }}>Cash</span>
                  ) : (
                    <button
                      type="button"
                      className="chip"
                      aria-label={`Kind ${KIND_LABEL[effectiveKind]}. Activate to cycle.`}
                      title={`${KIND_LABEL[effectiveKind]} — click or Alt+K to cycle`}
                      disabled={pending}
                      onClick={cycleKind}
                      style={{
                        background: effectiveKind === "cash" ? "#fff" : "var(--accent-soft)",
                        color: effectiveKind === "cash" ? "var(--ink-3)" : "var(--accent-ink)",
                        border: "none",
                        cursor: pending ? "default" : "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {KIND_LABEL[effectiveKind]}
                    </button>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: 34, height: 30, padding: 0, borderRadius: 8 }}
                    onClick={() => submit()}
                    disabled={pending}
                    aria-label="Add entry"
                  >
                    <IconPlus size={16} />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-2)", fontSize: 12, color: "var(--ink-3)" }}>
          Enter commits · Alt+S section · Alt+K kind · date sticky until you edit it
        </div>
        {formErr && (
          <div style={{ padding: "0 14px 12px", color: "var(--neg)", fontSize: 13 }}>
            {formErr}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>This session</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {sessionTransactions.length === 0
            ? "Nothing added yet this visit"
            : `${sessionTransactions.length} added · newest first`}
        </span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {sessionTransactions.length === 0 ? (
          <div className="muted" style={{ padding: "22px 14px", textAlign: "center", fontSize: 13.5 }}>
            Entries you save here show up in this list until you leave the page.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Section</th>
                  <th style={{ width: 120 }}>Date</th>
                  <th>Name</th>
                  <th style={{ width: 120 }}>Amount</th>
                  <th style={{ width: 88 }}>Kind</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {sessionTransactions.map((r) => {
                  const rowPending = pendingIds.has(r.id);
                  const rowSection = r.section;
                  const rowKind: TxnKind = rowSection === "income" ? "cash" : r.kind;
                  return (
                    <tr key={r.id} style={{ opacity: rowPending ? 0.55 : 1 }}>
                      <td>
                        <button
                          type="button"
                          className="chip"
                          disabled={rowPending}
                          aria-label={`Section ${SECTION_LABEL[rowSection]}. Activate to cycle.`}
                          title={`${SECTION_LABEL[rowSection]} — click to cycle`}
                          onClick={() => {
                            const next = nextSection(rowSection);
                            const patch: Partial<Omit<Transaction, "id">> =
                              next === "income"
                                ? { section: next, kind: "cash" }
                                : { section: next };
                            patchRow(r.id, patch);
                          }}
                          style={{
                            background: "var(--surface-2)",
                            color: "var(--ink-2)",
                            border: "none",
                            cursor: rowPending ? "default" : "pointer",
                            fontWeight: 600,
                            fontSize: 12,
                          }}
                        >
                          {SECTION_LABEL[rowSection]}
                        </button>
                      </td>
                      <td>
                        <DateCell
                          value={r.date}
                          onChange={(v) => {
                            if (monthKey(v) !== month) {
                              setRowErr("Date must be in the selected month");
                              return;
                            }
                            patchRow(r.id, { date: v });
                          }}
                        />
                      </td>
                      <td>
                        <CategoryInput
                          value={localCategories[r.id] ?? r.category}
                          section={rowSection}
                          onChange={(v) => setLocalCategories((prev) => ({ ...prev, [r.id]: v }))}
                          onCommit={(v) => { if (v !== r.category) patchRow(r.id, { category: v }); }}
                          onSubmit={(v) => { if (v !== r.category) patchRow(r.id, { category: v }); }}
                        />
                      </td>
                      <td>
                        <AmountInput
                          value={r.amount}
                          onChange={(v) => {
                            const next = v ?? 0;
                            if (next !== r.amount) patchRow(r.id, { amount: next });
                          }}
                        />
                      </td>
                      <td>
                        {rowSection === "income" ? (
                          <span className="muted" style={{ fontSize: 12 }}>Cash</span>
                        ) : (
                          <button
                            type="button"
                            className="chip"
                            disabled={rowPending}
                            aria-label={`Kind ${KIND_LABEL[rowKind]}. Activate to cycle.`}
                            title={`${KIND_LABEL[rowKind]} — click to cycle`}
                            onClick={() => patchRow(r.id, { kind: nextKind(rowKind) })}
                            style={{
                              background: rowKind === "cash" ? "var(--surface-2)" : "var(--accent-soft)",
                              color: rowKind === "cash" ? "var(--ink-3)" : "var(--accent-ink)",
                              border: "none",
                              cursor: rowPending ? "default" : "pointer",
                              fontWeight: 600,
                            }}
                          >
                            {KIND_LABEL[rowKind]}
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="x-btn"
                          disabled={rowPending}
                          aria-label="Remove"
                          onClick={() => removeRow(r.id, r.date)}
                        >
                          <IconX size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rowErr && (
          <div style={{ padding: "0 14px 12px", color: "var(--neg)", fontSize: 13 }}>
            {rowErr}
          </div>
        )}
      </div>
    </div>
  );
}
