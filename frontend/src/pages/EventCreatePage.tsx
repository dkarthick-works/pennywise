import { useLocation } from "react-router-dom";
import { EventForm } from "../components/events/EventForm";
import { useEventMutations } from "../hooks/useEvents";
import { eventsReturnPath } from "../lib/events";
export function EventCreatePage() {
  const { create } = useEventMutations();
  const { state } = useLocation();
  return <div className="content fade-in events-page"><EventForm returnPath={eventsReturnPath(state)} onSave={input => create.mutateAsync(input)} /></div>;
}
