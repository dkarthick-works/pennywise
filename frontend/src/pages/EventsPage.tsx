import { useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { EventStatus } from "../api/events";
import { useEventList } from "../hooks/useEvents";
import { EventStatusChip, eventAccountingNote } from "../components/events/EventSummary";
import { eventStatuses, eventStatusLabel } from "../lib/events";
import { money2 } from "../lib/money";
import { prettyDate } from "../lib/dates";

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const rawStatus = params.get("status") ?? "";
  const status = eventStatuses.includes(rawStatus as EventStatus) ? rawStatus as EventStatus : undefined;
  const rawOffset = params.get("offset") ?? "0";
  const offset = /^\d+$/.test(rawOffset) && Number(rawOffset) <= 2147483647 ? Number(rawOffset) : 0;
  const query = useEventList({ status, limit: 50, offset });
  const returnState = { eventsReturn: `/events${location.search}` };
  function page(next: number) { setParams({ ...(status ? { status } : {}), ...(next ? { offset: String(next) } : {}) }); }
  useEffect(() => {
    if (query.isSuccess && query.data.events.length === 0 && offset > 0) {
      setParams({ ...(status ? { status } : {}), offset: String(Math.max(0, offset - 50)) }, { replace: true });
    }
  }, [query.isSuccess, query.data, offset, status, setParams]);
  return <div className="content fade-in events-page">
    <div className="page-head"><div><h1 className="page-title">Events</h1><p className="page-sub">Plan costs and track what your events actually cost.</p></div><Link className="btn btn-primary" to="/events/new" state={returnState}>+ Create event</Link></div>
    <p className="event-accounting muted">{eventAccountingNote}</p>
    {location.state?.eventNotice === "This event was already unavailable." && <p role="status">This event was already unavailable.</p>}
    <div className="field event-filter"><label htmlFor="events-filter">Status</label><select id="events-filter" className="input" value={status ?? ""} onChange={e => setParams(e.target.value ? { status: e.target.value } : {})}><option value="">All events</option>{eventStatuses.map(s => <option key={s} value={s}>{eventStatusLabel[s]}</option>)}</select></div>
    {query.isPending ? <p>Loading events…</p> : query.isError ? <div role="alert"><p>Could not load events.</p><button className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></div> : !query.data.events.length ? <div className="card card-pad"><p>{status ? "No events with this status." : "No events yet. Create a plan and add your estimates whenever you are ready."}</p>{status ? <button className="btn btn-soft" onClick={() => setParams({})}>Clear filter</button> : <Link to="/events/new" state={returnState}>Create your first event</Link>}</div> : <>
      <div className="event-list" role="list">{query.data.events.map(e => <article className="card card-pad event-list-item" role="listitem" key={e.id}>
        <div><h2 className="card-h"><Link to={`/events/${e.id}`} state={returnState}>{e.name}</Link></h2><span className="muted">{e.target_date ? prettyDate(e.target_date) : "No date"}</span></div>
        <EventStatusChip status={e.status} />
        <div><span className="stat-lbl">{e.summary.budget_complete ? "Expected total" : "Known expected total"}</span><div className="num">{money2(e.summary.expected_total)}</div>{!e.summary.budget_complete && <small className="muted">Estimate incomplete · {e.summary.missing_expected_count} missing{!e.summary.item_count ? " · no items" : ""}</small>}</div>
        <div><span className="stat-lbl">Actual incurred so far</span><div className="num">{money2(e.summary.actual_total)}</div>{!e.summary.actuals_complete && <small className="muted">{e.summary.item_count ? `Actuals incomplete · ${e.summary.missing_actual_count} missing` : "No costs entered"}</small>}</div>
        <small className="muted">Suggestions {e.suggestions_enabled ? "on" : "off"}</small>
      </article>)}</div>
      <nav className="event-actions event-pagination" aria-label="Events pages"><button className="btn btn-soft" disabled={offset === 0} onClick={() => page(Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}</span><button className="btn btn-soft" disabled={!query.data.has_more} onClick={() => page(offset + 50)}>Next</button></nav>
    </>}
  </div>;
}
