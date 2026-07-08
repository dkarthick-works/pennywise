import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTxnsByMonth } from "../api/ledger";
import { TransactionListTable } from "../components/dashboard/TransactionListTable";
import { IconChevL } from "../components/ui/Icons";
import { monthLabel } from "../lib/dates";
import { inr } from "../lib/money";
import { creditExpenseTransactions } from "../lib/txns";

export function CreditTransactionsPage({ month }: { month: string }) {
  const navigate = useNavigate();

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["txns", "month", month],
    queryFn: () => getTxnsByMonth(month),
  });

  const rows = creditExpenseTransactions(data);
  const total = rows.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="content fade-in">
      <button
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate("/dashboard")}
      >
        <IconChevL size={15} /> Dashboard
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Credit Card Transactions</h1>
          <p className="page-sub">Transactions for {monthLabel(month)}</p>
        </div>
        <div
          className="card card-pad"
          style={{ minWidth: 220, padding: "14px 18px", textAlign: "right" }}
        >
          <div className="stat-lbl" style={{ marginBottom: 4 }}>Credit total</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {inr(total)}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {isLoading ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading transactions...</p>
        ) : isError ? (
          <p style={{ margin: 0, padding: 18, color: "var(--neg)", fontSize: 13 }}>
            Could not load credit transactions.
          </p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No credit transactions in {monthLabel(month)}.
          </p>
        ) : (
          <TransactionListTable rows={rows} showKind={false} />
        )}
      </div>
    </div>
  );
}
