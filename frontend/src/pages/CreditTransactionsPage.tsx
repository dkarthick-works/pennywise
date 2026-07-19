import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { getCreditTransactions, creditUsageKeys } from "../api/ledger";
import { TransactionListTable } from "../components/dashboard/TransactionListTable";
import { IconChevL } from "../components/ui/Icons";
import { monthLabel, prettyDate } from "../lib/dates";
import { inr } from "../lib/money";
import type { CreditTransactionView } from "../types";

const MONTH_RE = /^\d{4}-\d{2}$/;

export function CreditTransactionsPage({
  month: fallbackMonth,
  setMonth,
}: {
  month: string;
  setMonth: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawMonth = searchParams.get("month");
  const rawView = searchParams.get("view");
  const month = rawMonth && MONTH_RE.test(rawMonth) ? rawMonth : fallbackMonth;
  const view: CreditTransactionView = rawView === "billing" ? "billing" : "calendar";

  // Canonicalize missing/invalid params into the URL so refreshes and direct
  // links resolve to a stable month + view (replace, so we don't spam history).
  useEffect(() => {
    if (searchParams.get("month") !== month || searchParams.get("view") !== view) {
      const next = new URLSearchParams(searchParams);
      next.set("month", month);
      next.set("view", view);
      setSearchParams(next, { replace: true });
    }
  }, [month, view, searchParams, setSearchParams]);

  // Keep the in-memory dashboard month in sync so Back lands on the same month.
  useEffect(() => {
    if (month !== fallbackMonth) setMonth(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: creditUsageKeys.detail(month, view),
    queryFn: () => getCreditTransactions(month, view),
  });

  // The billing view 400s when no statement day is configured — treat that as a
  // setup prompt rather than a generic failure.
  const billingUnset =
    view === "billing" && isError && axios.isAxiosError(error) && error.response?.status === 400;

  const setView = (v: CreditTransactionView) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", v);
    next.set("month", month);
    setSearchParams(next, { replace: true });
  };

  const rows = data?.transactions ?? [];

  return (
    <div className="content fade-in">
      <button
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate(`/dashboard?month=${month}`)}
      >
        <IconChevL size={15} /> Dashboard
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Credit Card Transactions</h1>
          <p className="page-sub">
            {view === "billing" ? "Statement cycle" : "Calendar month"} · {monthLabel(month)}
            {data ? ` · ${prettyDate(data.from)} – ${prettyDate(data.to)}` : ""}
          </p>
        </div>
        <div className="card card-pad" style={{ minWidth: 220, padding: "14px 18px", textAlign: "right" }}>
          <div className="stat-lbl" style={{ marginBottom: 4 }}>Credit total</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {data ? inr(data.total) : "—"}
          </div>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Credit usage view" style={{ marginBottom: 16 }}>
        <button
          role="tab"
          aria-selected={view === "calendar"}
          className={view === "calendar" ? "on" : ""}
          onClick={() => setView("calendar")}
        >
          Calendar month
        </button>
        <button
          role="tab"
          aria-selected={view === "billing"}
          className={view === "billing" ? "on" : ""}
          onClick={() => setView("billing")}
        >
          Statement cycle
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {isLoading ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading transactions...</p>
        ) : billingUnset ? (
          <div style={{ padding: 18 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13.5, fontWeight: 600 }}>
              No statement date configured.
            </p>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: 13 }}>
              Set your credit card statement date to view spend by billing cycle.
            </p>
            <button className="btn btn-soft" onClick={() => navigate("/settings#credit-billing-cycle")}>
              Set statement date
            </button>
          </div>
        ) : isError ? (
          <div style={{ padding: 18 }}>
            <p style={{ margin: "0 0 12px", color: "var(--neg)", fontSize: 13 }}>
              Could not load credit transactions.
            </p>
            <button className="btn btn-soft" onClick={() => refetch()}>Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No credit transactions in this {view === "billing" ? "statement cycle" : "month"}.
          </p>
        ) : (
          <TransactionListTable rows={rows} showKind={false} />
        )}
      </div>
    </div>
  );
}
