import type { EventStatus, EventSummaryDTO } from "../../api/events";
import { eventStatusLabel } from "../../lib/events";
import { money2 } from "../../lib/money";

export const eventAccountingNote = "Event costs are tracked separately and do not update cash flow. Record payments in Transactions to include them there.";
export function EventStatusChip({ status }: { status: EventStatus }) {
  return <span className={`chip event-status-${status}`}>{eventStatusLabel[status]}</span>;
}
export function EventSummary({ summary, saved = false }: { summary: EventSummaryDTO; saved?: boolean }) {
  return <section className="card card-pad event-summary" aria-label={saved ? "Last saved totals" : "Event totals"}>
    {saved && <p className="muted event-span">Last saved totals · totals update after Save.</p>}
    <div><div className="stat-lbl">{summary.budget_complete ? "Expected total" : "Known expected total"}</div><strong className="num">{money2(summary.expected_total)}</strong>
      {!summary.budget_complete && <p className="muted">{summary.item_count === 0 ? "No items yet" : `Estimate incomplete · ${summary.missing_expected_count} missing`}</p>}</div>
    <div><div className="stat-lbl">{summary.actuals_complete ? "Actual incurred so far" : "Recorded actual total"}</div><strong className="num">{money2(summary.actual_total)}</strong>
      {!summary.actuals_complete && <p className="muted">{summary.item_count === 0 ? "No costs entered" : `Actuals incomplete · ${summary.missing_actual_count} missing`}</p>}</div>
  </section>;
}
