import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getEventSuggestions } from "../../api/events";
import { eventKeys } from "../../lib/eventQueryKeys";
import { currentMonth, prettyDate } from "../../lib/dates";
import { money2 } from "../../lib/money";
import { retryEventRead } from "../../hooks/useEvents";

function browserCalendar() {
  let timezone = "UTC";
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* UTC fallback */ }
  return { month: timezone === "UTC" ? new Date().toISOString().slice(0, 7) : currentMonth(), timezone };
}
export function EventSuggestions({ month }: { month: string }) {
  const [calendar, setCalendar] = useState(browserCalendar);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      const calendar = browserCalendar();
      setCalendar(calendar);
      clearTimeout(timer);
      const now = new Date();
      const next = calendar.timezone === "UTC"
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        : new Date(now.getFullYear(), now.getMonth() + 1, 1);
      // At most one day between checks, with an exact check at month rollover.
      timer = setTimeout(check, Math.min(86400000, Math.max(50, next.getTime() - now.getTime() + 50)));
    }
    timer = setTimeout(check, 0);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, []);
  if (month !== calendar.month) return null;
  return <CurrentSuggestions key={`${month}-${calendar.timezone}`} month={month} timezone={calendar.timezone} />;
}
function CurrentSuggestions({ month, timezone }: { month: string; timezone: string }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery({ queryKey: eventKeys.suggestionPage(month, timezone, offset), queryFn: ({ signal }) => getEventSuggestions(month, timezone, offset, signal), retry: retryEventRead });
  const data = query.data;
  // The server remains authoritative if client time differs from server time.
  if (data && data.current_month !== month) return null;
  return <section className="card card-pad event-suggestions" aria-label="Event suggestions">
    <div className="event-section-head"><h2 className="card-h">Events you could consider this month</h2><Link to="/events">All events</Link></div>
    {query.isPending ? <p className="muted">Loading suggestions…</p> : query.isError ? <div role="alert"><p>Could not load event suggestions.</p><button className="btn btn-soft" onClick={() => void query.refetch()}>Retry suggestions</button></div> : !data?.events.length ? <p className="muted">No event suggestions right now. You can still plan and edit your events.</p> : <ul>{data.events.map(event => <li key={event.id}><div><strong>{event.name}</strong><p className="muted">{money2(event.summary.expected_total)}{event.target_date ? ` · ${prettyDate(event.target_date)}` : ""}</p></div><Link className="btn btn-soft" to={`/events/${event.id}`} aria-label={`View event: ${event.name}`}>View event</Link></li>)}</ul>}
    {(offset > 0 || data?.has_more) && <nav className="event-actions event-pagination" aria-label="Suggestion pages"><button className="btn btn-soft" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 5))}>Previous</button><button className="btn btn-soft" disabled={!data?.has_more} onClick={() => setOffset(offset + 5)}>Next</button></nav>}
  </section>;
}
