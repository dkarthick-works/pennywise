import { Link, useParams } from "react-router-dom";
import { EventForm } from "../components/events/EventForm";
import { useEvent, useEventMutations } from "../hooks/useEvents";
import { EventsApiError } from "../api/events";
import type { EventUpdateInput } from "../api/events";
export function EventEditPage() {
  const { id = "" } = useParams();
  const query = useEvent(id);
  const { update } = useEventMutations();
  return <div className="content fade-in events-page">{query.data ? <EventForm key={id} event={query.data} returnPath={`/events/${id}`} onSave={input => update.mutateAsync({ id, body: input as EventUpdateInput })} onReload={async () => { const result = await query.refetch(); if (result.error) throw result.error; if (!result.data) throw new Error("Event unavailable"); return result.data; }} /> : query.isPending ? <p>Loading event…</p> : <><Link to="/events">All events</Link><p role="alert">{query.error instanceof EventsApiError && query.error.status === 404 ? "This event is no longer available." : "Could not load this event."}</p><button className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></>}</div>;
}
