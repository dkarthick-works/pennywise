import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getDashboardMonthly, getTxnsByMonth } from "../api/ledger";
import { TransactionListTable } from "../components/dashboard/TransactionListTable";
import { IconChevL, IconChevR } from "../components/ui/Icons";
import { monthLabel } from "../lib/dates";
import { inr } from "../lib/money";

const MONTH_RE = /^\d{4}-\d{2}$/;

function signedInr(value: number) {
  return `${value >= 0 ? "+" : "−"}${inr(Math.abs(value))}`;
}

function SignedStat({
  label,
  value,
  ready,
  size = 24,
}: {
  label: string;
  value: number | undefined;
  ready: boolean;
  size?: number;
}) {
  const amount = value ?? 0;
  return (
    <div className="cash-flow-stats-item">
      <div className="stat-lbl" style={{ marginBottom: 4 }}>{label}</div>
      <div
        className="num"
        style={{
          fontSize: size,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          color: amount >= 0 ? "var(--pos)" : "var(--neg)",
        }}
      >
        {ready ? signedInr(amount) : "—"}
      </div>
    </div>
  );
}
const OUTFLOW_SECTIONS = new Set(["essential", "flexible", "daily"]);
const SECTION_ORDER = [
  { key: "essential", label: "Essential" },
  { key: "flexible", label: "Flexible" },
  { key: "daily", label: "Daily" },
] as const;

export function CashFlowTransactionsPage({
  month: fallbackMonth,
  setMonth,
}: {
  month: string;
  setMonth: (month: string) => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set());
  const [showBudgetRemaining, setShowBudgetRemaining] = useState(false);
  const rawMonth = searchParams.get("month");
  const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : fallbackMonth;

  useEffect(() => {
    if (searchParams.get("month") !== month) {
      const next = new URLSearchParams(searchParams);
      next.set("month", month);
      setSearchParams(next, { replace: true });
    }
  }, [month, searchParams, setSearchParams]);

  useEffect(() => {
    if (month !== fallbackMonth) setMonth(month);
  }, [fallbackMonth, month, setMonth]);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["txns", "month", month],
    queryFn: () => getTxnsByMonth(month),
  });
  const dashboardQuery = useQuery({
    queryKey: ["dashboard", "monthly", month],
    queryFn: () => getDashboardMonthly(month),
  });
  const dashboardReady = dashboardQuery.isSuccess && !!dashboardQuery.data;

  const rows = data.filter(
    (transaction) =>
      OUTFLOW_SECTIONS.has(transaction.section) &&
      (transaction.kind === "cash" || transaction.kind === "settlement") &&
      transaction.amount > 0
  );
  const total = rows.reduce((sum, transaction) => sum + transaction.amount, 0);
  const groups = SECTION_ORDER.map((section) => ({
    ...section,
    rows: rows.filter((transaction) => transaction.section === section.key),
  }))
    .map((section) => ({
      ...section,
      subtotal: section.rows.reduce((sum, transaction) => sum + transaction.amount, 0),
    }))
    .filter((section) => section.rows.length > 0);

  const toggleSection = (section: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className="content fade-in">
      <button
        type="button"
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate(`/dashboard?month=${month}`)}
      >
        <IconChevL size={15} /> Dashboard
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Cash Flow Transactions</h1>
          <p className="page-sub">Cash + settlements · {monthLabel(month)} · by payment date</p>
        </div>
      </div>

      <div className="card card-pad cash-flow-stats">
        <div className="cash-flow-stats-grid">
          <div className="cash-flow-stats-item">
            <div className="stat-lbl" style={{ marginBottom: 4 }}>Cash out</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
              {isLoading || isError ? "—" : inr(total)}
            </div>
          </div>
          <SignedStat
            label="Balance remaining"
            value={dashboardQuery.data?.remaining_balance}
            ready={dashboardReady}
          />
          <SignedStat
            label="Free money"
            value={dashboardQuery.data?.free_money}
            ready={dashboardReady}
          />
        </div>
        <div className="cash-flow-debug">
          <button
            type="button"
            className="cash-flow-debug-toggle"
            aria-expanded={showBudgetRemaining}
            aria-controls="cash-flow-budget-remaining"
            onClick={() => setShowBudgetRemaining((open) => !open)}
          >
            <IconChevR
              size={14}
              style={{
                transform: showBudgetRemaining ? "rotate(90deg)" : "none",
                transition: "transform .15s",
              }}
            />
            Budget remaining
          </button>
          {showBudgetRemaining && (
            <div id="cash-flow-budget-remaining" className="cash-flow-stats-grid">
              <SignedStat
                label="bare_minimum_remaining"
                value={dashboardQuery.data?.bare_minimum_remaining}
                ready={dashboardReady}
                size={18}
              />
              <SignedStat
                label="subscriptions_budget_remaining"
                value={dashboardQuery.data?.subscriptions_budget_remaining}
                ready={dashboardReady}
                size={18}
              />
              <SignedStat
                label="daily_budget_remaining"
                value={dashboardQuery.data?.daily_budget_remaining}
                ready={dashboardReady}
                size={18}
              />
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading transactions...</p>
        </div>
      ) : isError ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: 18 }}>
            <p style={{ margin: "0 0 12px", color: "var(--neg)", fontSize: 13 }}>
              Could not load cash flow transactions.
            </p>
            <button type="button" className="btn btn-soft" onClick={() => refetch()}>Retry</button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No cash or settlement transactions in this month.
          </p>
        </div>
      ) : (
        <div className="grid">
          {groups.map((group) => {
            const expanded = !collapsedSections.has(group.key);
            const panelId = `cash-flow-${group.key}-transactions`;
            return (
              <section key={group.key} className="card" style={{ overflow: "hidden" }}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label} section`}
                  onClick={() => toggleSection(group.key)}
                  style={{
                    width: "100%",
                    padding: "14px 18px",
                    border: 0,
                    borderBottom: expanded ? "1px solid var(--border)" : 0,
                    background: "transparent",
                    color: "inherit",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconChevR
                      size={16}
                      style={{ color: "var(--ink-3)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                    />
                    <h2 className="card-h" style={{ margin: 0 }}>{group.label}</h2>
                  </span>
                  <span
                    className="num"
                    aria-label={`${group.label} subtotal`}
                    style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)" }}
                  >
                    {inr(group.subtotal)}
                  </span>
                </button>
                {expanded && (
                  <div id={panelId}>
                    <TransactionListTable rows={group.rows} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
