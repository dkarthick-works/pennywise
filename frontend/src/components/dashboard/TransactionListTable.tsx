import { inr } from "../../lib/money";
import { prettyDate } from "../../lib/dates";
import type { Section, Transaction, TxnKind } from "../../types";

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

export function TransactionListTable({
  rows,
  showKind = true,
}: {
  rows: Transaction[];
  showKind?: boolean;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 120 }}>Date</th>
            <th>Category</th>
            <th style={{ width: 130 }}>Section</th>
            {showKind && <th style={{ width: 130 }}>Kind</th>}
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
                {showKind && (
                  <td>
                    <span className={`chip ${kind.className ?? ""}`.trim()}>
                      {kind.label}
                    </span>
                  </td>
                )}
                <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                  {inr(t.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
