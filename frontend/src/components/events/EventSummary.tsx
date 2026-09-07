import { Link } from "react-router-dom";
import type { EventStatus, EventSummaryDTO, PlannedEvent } from "../../api/events";
import { eventBudgetSnapshot, eventStatusLabel } from "../../lib/events";
import { money2 } from "../../lib/money";
import { prettyDate } from "../../lib/dates";
import { IconCalendar, IconCheck, IconSparkles, IconWrench } from "../ui/Icons";

export const eventAccountingNote = "Event costs are tracked separately and do not update cash flow. Record payments in Transactions to include them there.";
export function EventStatusChip({ status }: { status: EventStatus }) {
  return <span className={`chip event-status-${status}`}>{status === "completed" && <IconCheck size={12} />}<span>{eventStatusLabel[status]}</span></span>;
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
export function EventListCard({ event, returnState }: { event: PlannedEvent; returnState: { eventsReturn: string } }) {
  const snap = eventBudgetSnapshot(event.summary.expected_total, event.summary.actual_total);
  const varianceLabel = event.summary.expected_total <= 0 ? "Variance" : snap.remaining > 0 ? "Under budget" : snap.remaining < 0 ? "Over budget" : "On budget";
  const varianceNote = snap.savedPct != null && snap.remaining > 0 ? `${snap.savedPct}% saved` : snap.overPct != null ? `${snap.overPct}% over` : null;
  return <article className="card card-pad event-list-item" role="listitem">
    <div className="event-list-head">
      <span className="event-list-icon" aria-hidden="true"><IconWrench size={20} /></span>
      <div className="event-list-title">
        <h2 className="event-list-name"><Link to={`/events/${event.id}`} state={returnState}>{event.name}</Link></h2>
        <span className="muted event-list-date"><IconCalendar size={14} />{event.target_date ? prettyDate(event.target_date) : "Date not set"}</span>
      </div>
      <EventStatusChip status={event.status} />
    </div>
    <div className="event-list-metrics">
      <div><span className="stat-lbl">{event.summary.budget_complete ? "Expected" : "Known expected"}</span><div className="num">{money2(event.summary.expected_total)}</div>{!event.summary.budget_complete && <small className="muted">Estimate incomplete · {event.summary.missing_expected_count} missing{!event.summary.item_count ? " · no items" : ""}</small>}</div>
      <div><span className="stat-lbl">Actual</span><div className="num">{money2(event.summary.actual_total)}</div>{!event.summary.actuals_complete && <small className="muted">{event.summary.item_count ? `Actuals incomplete · ${event.summary.missing_actual_count} missing` : "No costs entered"}</small>}</div>
      <div><span className="stat-lbl">{varianceLabel}</span><div className={`num${event.summary.expected_total > 0 && snap.remaining > 0 ? " event-list-pos" : event.summary.expected_total > 0 && snap.remaining < 0 ? " event-list-neg" : ""}`}>{event.summary.expected_total <= 0 ? "—" : money2(Math.abs(snap.remaining))}</div>{varianceNote && <small className="muted">{varianceNote}</small>}</div>
    </div>
    <div className="event-list-used"><span>Budget used</span><div className="event-list-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snap.usedPct ?? 0} aria-label="Budget used"><span style={{ width: `${snap.barPct}%`, background: snap.remaining < 0 ? "var(--neg)" : "var(--accent)" }} /></div><span>{snap.usedPct == null ? "—" : `${snap.usedPct}%`}</span></div>
    <div className="event-list-foot"><IconSparkles size={14} /><span>Suggestions {event.suggestions_enabled ? "on" : "off"}</span></div>
  </article>;
}
