import { useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { EventStatus } from "../api/events";
import { useEventList } from "../hooks/useEvents";
import { EventListCard, eventAccountingNote } from "../components/events/EventSummary";
import { eventStatuses, eventStatusLabel } from "../lib/events";

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
    <div id="events-filter" className="seg event-filter" role="tablist" aria-label="Status">
      <button type="button" role="tab" aria-selected={!status} className={!status ? "on" : ""} onClick={() => setParams({})}>All events</button>
      {eventStatuses.map(s => <button type="button" role="tab" key={s} aria-selected={status === s} className={status === s ? "on" : ""} onClick={() => setParams({ status: s })}>{eventStatusLabel[s]}</button>)}
    </div>
    {query.isPending ? <p>Loading events…</p> : query.isError ? <div role="alert"><p>Could not load events.</p><button className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></div> : !query.data.events.length ? <div className="card card-pad"><p>{status ? "No events with this status." : "No events yet. Create a plan and add your estimates whenever you are ready."}</p>{status ? <button className="btn btn-soft" onClick={() => setParams({})}>Clear filter</button> : <Link to="/events/new" state={returnState}>Create your first event</Link>}</div> : <>
      <div className="event-list" role="list">{query.data.events.map(e => <EventListCard key={e.id} event={e} returnState={returnState} />)}</div>
      <nav className="event-actions event-pagination" aria-label="Events pages"><button className="btn btn-soft" disabled={offset === 0} onClick={() => page(Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}</span><button className="btn btn-soft" disabled={!query.data.has_more} onClick={() => page(offset + 50)}>Next</button></nav>
    </>}
  </div>;
}
