import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getCategoryGroupTransactions } from "../api/ledger";
import { TransactionListTable } from "../components/dashboard/TransactionListTable";
import { IconChevL, IconTrend } from "../components/ui/Icons";
import { inr } from "../lib/money";
import { monthLabel } from "../lib/dates";
import { isMonthKey } from "../lib/groupSpendComparison";

export function CategoryGroupPage({ month }: { month: string }) {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams] = useSearchParams();
  const queryMonth = searchParams.get("month");
  const activeMonth = isMonthKey(queryMonth) ? queryMonth : month;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["category-group-txns", groupId, activeMonth],
    queryFn: () => getCategoryGroupTransactions(groupId!, activeMonth),
    enabled: Boolean(groupId),
  });

  const rows = data?.transactions ?? [];

  return (
    <div className="content fade-in">
      <button
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate("/dashboard#category-groups")}
      >
        <IconChevL size={15} /> Dashboard
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{data?.group_name ?? "Category Group"}</h1>
          <p className="page-sub">
            Transactions for {monthLabel(data?.month ?? activeMonth)}
          </p>
          {groupId && (
            <button
              type="button"
              className="btn btn-soft"
              style={{ marginTop: 12, padding: "7px 12px" }}
              onClick={() => navigate(`/dashboard/groups/${groupId}/compare?to=${activeMonth}&range=6`)}
            >
              <IconTrend size={16} /> Compare over time
            </button>
          )}
        </div>
        <div
          className="card card-pad"
          style={{ minWidth: 220, padding: "14px 18px", textAlign: "right" }}
        >
          <div className="stat-lbl" style={{ marginBottom: 4 }}>Group total</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {inr(data?.total ?? 0)}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {isLoading ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading transactions...</p>
        ) : isError ? (
          <p style={{ margin: 0, padding: 18, color: "var(--neg)", fontSize: 13 }}>
            Could not load category group transactions.
          </p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No transactions for this group in {monthLabel(data?.month ?? activeMonth)}.
          </p>
        ) : (
          <TransactionListTable rows={rows} />
        )}
      </div>
    </div>
  );
}
