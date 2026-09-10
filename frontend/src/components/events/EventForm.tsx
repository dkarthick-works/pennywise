import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EventsApiError } from "../../api/events";
import type { EventInput, EventUpdateInput, PlannedEventDetail } from "../../api/events";
import { eventDraft, eventStatuses, eventStatusLabel, newEventItem, serializeEvent } from "../../lib/events";
import type { EventItemDraft } from "../../lib/events";
import { EventSummary, eventAccountingNote } from "./EventSummary";
import { IconArrowD, IconArrowU, IconPlus, IconTrash } from "../ui/Icons";

interface Props {
  event?: PlannedEventDetail;
  onSave: (input: EventInput | EventUpdateInput) => Promise<PlannedEventDetail>;
  onReload?: () => Promise<PlannedEventDetail>;
  returnPath: string;
}
export function EventForm({ event, onSave, onReload, returnPath }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  // Freeze base/version until a successful save or explicit reload, never on query refetch.
  const [base, setBase] = useState(event);
  const [initial, setInitial] = useState(() => eventDraft(event));
  const [draft, setDraft] = useState(() => eventDraft(event));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty && !pending) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const guard = (e: Event) => { if (!window.confirm("Discard unsaved event changes and leave?")) e.preventDefault(); };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("events:before-navigate", guard);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("events:before-navigate", guard); };
  }, [dirty, pending]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function leave() {
    if ((dirty || pending) && !window.confirm("Discard unsaved event changes and leave?")) return;
    navigate(unavailable ? "/events" : returnPath, { state: location.state });
  }
  function patchItem(key: string, patch: Partial<EventItemDraft>) {
    setDraft(d => ({ ...d, items: d.items.map(i => i.key === key ? { ...i, ...patch } : i) }));
  }
  function move(index: number, delta: number) {
    setDraft(d => { const items = [...d.items]; [items[index], items[index + delta]] = [items[index + delta], items[index]]; return { ...d, items }; });
  }
  function remove(item: EventItemDraft) {
    if (item.id && !window.confirm(`Remove “${item.name}”? Saving removes this item and its costs; item history cannot be restored.`)) return;
    setDraft(d => ({ ...d, items: d.items.filter(i => i.key !== item.key) }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (pending || blocked || unavailable) return;
    setError("");
    try {
      const input = serializeEvent(draft);
      setPending(true);
      const saved = await onSave(base ? { ...input, version: base.version } : input);
      navigate(`/events/${saved.id}`, { replace: true, state: location.state });
    } catch (e) {
      if (e instanceof EventsApiError && e.status === 409) {
        setBlocked(true); setError("This event changed elsewhere. Your draft is preserved. Reload the latest version before saving.");
      } else if (e instanceof EventsApiError && e.status === 404) {
        setUnavailable(true); setError("This event is no longer available. Your unsaved text is preserved until you leave.");
      } else {
        setError((e instanceof Error ? e.message : "Could not save event.") + (!base && e instanceof EventsApiError && !e.status ? ". The save may have reached the server. Check the Events list before creating again." : ""));
      }
    } finally { setPending(false); }
  }
  async function reload() {
    if (!onReload || !window.confirm("Discard this draft and reload the latest event?")) return;
    setPending(true);
    try { const latest = await onReload(); const fresh = eventDraft(latest); setBase(latest); setInitial(fresh); setDraft(fresh); setBlocked(false); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reload event."); }
    finally { setPending(false); }
  }
  return <>
    <button type="button" className="btn btn-soft" onClick={leave} disabled={pending}>← {base ? "Back to event" : "All events"}</button>
    <div className="page-head"><div><h1 className="page-title">{base ? "Edit event" : "Create event"}</h1><p className="page-sub">{eventAccountingNote}</p></div></div>
    {base && <EventSummary summary={base.summary} saved />}
    <form className="card card-pad event-form" onSubmit={submit}>
      <fieldset disabled={pending} className="event-fieldset">
        <div className="event-meta-grid">
          <div className="field"><label htmlFor="event-name">Event name</label><input id="event-name" className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} required maxLength={200} autoFocus /></div>
          <div className="field"><label htmlFor="event-date">Flexible date (optional)</label><div className="event-actions"><input id="event-date" className="input" type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /><button type="button" className="btn btn-ghost" onClick={() => setDraft({ ...draft, date: "" })} disabled={!draft.date}>Clear date</button></div><small className="muted">Not a deadline. Change it any time.</small></div>
          <div className="field"><label htmlFor="event-status">Status</label><select id="event-status" className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as typeof draft.status })}>{eventStatuses.map(s => <option key={s} value={s}>{eventStatusLabel[s]}</option>)}</select></div>
          <div className="field event-span"><label htmlFor="event-note">Note (optional)</label><textarea id="event-note" className="input" rows={3} maxLength={5000} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></div>
        </div>
        <label className="event-checkbox"><input type="checkbox" checked={draft.suggestions} onChange={e => setDraft({ ...draft, suggestions: e.target.checked })} />Suggest this when it fits my free money</label>
        <div className="event-section-head"><h2 className="card-h">Line items</h2><span className="muted">Enter 0 for a genuine zero. Actual cost includes unpaid bills. Totals update after saving.</span></div>
        {draft.items.length === 0 && <p className="muted event-items-empty">No items yet. You can save this plan now and add estimates later.</p>}
        <div className="event-items-editor">
          {draft.items.length > 0 && <div className="event-items-header" aria-hidden="true"><span>#</span><span>Item name</span><span>Expected cost (₹)</span><span>Actual incurred so far (₹)</span><span>Actions</span></div>}
          {draft.items.map((item, index) => <fieldset className="event-item-row" aria-label={`Line item ${index + 1}`} key={item.key}>
            <span className="event-item-index">{index + 1}</span>
            <input id={`name-${item.key}`} className="input" aria-label={`Item ${index + 1} name`} value={item.name} maxLength={200} required onChange={e => patchItem(item.key, { name: e.target.value })} />
            <input id={`expected-${item.key}`} className="input" aria-label={`Item ${index + 1} expected cost`} inputMode="decimal" placeholder="Not entered" value={item.expected} onChange={e => patchItem(item.key, { expected: e.target.value })} />
            <input id={`actual-${item.key}`} className="input" aria-label={`Item ${index + 1} actual incurred cost`} inputMode="decimal" placeholder="Not entered" value={item.actual} onChange={e => patchItem(item.key, { actual: e.target.value })} />
            <div className="event-item-actions">
              <button type="button" className="btn btn-ghost" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><IconArrowU size={17} /></button>
              <button type="button" className="btn btn-ghost" aria-label={`Move item ${index + 1} down`} disabled={index === draft.items.length - 1} onClick={() => move(index, 1)}><IconArrowD size={17} /></button>
              <button type="button" className="btn btn-ghost event-item-delete" aria-label={`Remove item ${index + 1}`} onClick={() => remove(item)}><IconTrash size={17} /></button>
            </div>
          </fieldset>)}
          <button type="button" className="event-add-row" disabled={draft.items.length >= 500} onClick={() => setDraft({ ...draft, items: [...draft.items, newEventItem()] })}><IconPlus size={17} /> Add row</button>
        </div>
      </fieldset>
      {error && <p className="err-msg" role="alert" tabIndex={-1} ref={errorRef}>{error}</p>}
      {blocked && <button type="button" className="btn btn-soft" onClick={() => void reload()} disabled={pending}>Discard draft and reload</button>}
      <div className="event-actions event-form-actions"><button type="submit" className="btn btn-primary" disabled={pending || blocked || unavailable}>{pending ? "Saving…" : base ? "Save event" : "Create event"}</button><button type="button" className="btn btn-ghost" onClick={leave} disabled={pending}>{unavailable ? "All events" : "Cancel"}</button></div>
    </form>
  </>;
}
