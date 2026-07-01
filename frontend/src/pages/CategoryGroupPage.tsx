import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getCategoryGroupTransactions } from "../api/ledger";
import { IconChevL } from "../components/ui/Icons";
import { inr } from "../lib/money";
import { monthLabel, prettyDate } from "../lib/dates";
import type { Section, TxnKind } from "../types";

const SECTION_META: Record<Section, { label: string; color: string; bg: string }> = {
  essential: { label: "Essential", color: "var(--c-essential)", bg: "var(--accent-soft)" },
  flexible: { label: "Flexible", color: "var(--c-flexible)", bg: "oklch(0.95 0.03 210)" },
  daily: { label: "Daily", color: "var(--c-daily)", bg: "oklch(0.95 0.03 240)" },
  income: { label: "Income", color: "var(--pos)", bg: "var(--pos-soft)" },
};

const KIND_META: Record<TxnKind, { label: string; className?: string }> = {
  cash: { label: "Cash", className: "chip-paid" },
  credit: { label: "Credit", className: "chip-cc" },
  settlement: { label: "Settlement", className: "chip-pending" },
};

export function CategoryGroupPage({ month }: { month: string }) {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["category-group-txns", groupId, month],
    queryFn: () => getCategoryGroupTransactions(groupId!, month),
    enabled: Boolean(groupId),
  });

  const rows = data?.transactions ?? [];

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
          <h1 className="page-title">{data?.group_name ?? "Category Group"}</h1>
          <p className="page-sub">
            Transactions for {monthLabel(data?.month ?? month)}
          </p>
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
            No transactions for this group in {monthLabel(data?.month ?? month)}.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Date</th>
                  <th>Category</th>
                  <th style={{ width: 130 }}>Section</th>
                  <th style={{ width: 130 }}>Kind</th>
                  <th style={{ width: 140, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const section = SECTION_META[t.section];
                  const kind = KIND_META[t.kind];
                  return (
                    <tr key={t.id}>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>{prettyDate(t.date)}</td>
                      <td style={{ fontWeight: 600 }}>{t.category}</td>
                      <td>
                        <span
                          className="chip"
                          style={{ background: section.bg, color: section.color }}
                        >
                          {section.label}
                        </span>
                      </td>
                      <td>
                        <span className={`chip ${kind.className ?? ""}`.trim()}>
                          {kind.label}
                        </span>
                      </td>
                      <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                        {inr(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
