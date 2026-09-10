import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { EventsApiError } from "../api/events";
import type { EventStatus } from "../api/events";
import { useEvent, useEventMutations } from "../hooks/useEvents";
import { eventKeys } from "../lib/eventQueryKeys";
import { eventsReturnPath, savedEventInput } from "../lib/events";
import { EventStatusChip, EventSummary, eventAccountingNote } from "../components/events/EventSummary";
import { prettyDate } from "../lib/dates";
import { money2 } from "../lib/money";
import type { Section } from "../types";
import { SECTION_LABEL } from "../lib/recordLabels";

const TRANSACTION_MAX = 999999999999.99;
type ConvertSection = Exclude<Section, "income">;
const CONVERT_SECTIONS: ConvertSection[] = ["essential", "flexible", "daily"];

export function EventDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useEvent(id);
  const { update, duplicate, convert, remove } = useEventMutations();
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [copyForm, setCopyForm] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyDate, setCopyDate] = useState("");
  const [convertForm, setConvertForm] = useState(false);
  const [convertDate, setConvertDate] = useState("");
  const [convertSection, setConvertSection] = useState<ConvertSection>("daily");
  const [deleteDialog, setDeleteDialog] = useState(false);
  const pending = update.isPending || duplicate.isPending || convert.isPending || remove.isPending;
  const back = eventsReturnPath(location.state);
  function failure(e: unknown, copying = false) {
    if (e instanceof EventsApiError && e.status === 409) { setConflict(true); setError("This event changed elsewhere. Reload before trying again."); }
    else if (e instanceof EventsApiError && e.status === 404) { setUnavailable(true); setError("This event is no longer available."); }
    else setError((e instanceof Error ? e.message : "Could not update event.") + (copying && e instanceof EventsApiError && !e.status ? ". The copy may have been created. Check All events before trying again." : ""));
  }
  async function changeStatus(status: EventStatus) {
    if (!query.data || pending || conflict || unavailable) return;
    if ((status === "cancelled" || status === "completed") && !window.confirm(`${status === "completed" ? "Complete" : "Cancel"} “${query.data.name}”? Recorded costs will be retained.`)) return;
    setError("");
    try { await update.mutateAsync({ id, body: savedEventInput(query.data, status) }); } catch (e) { failure(e); }
  }
  async function deleteCurrent(deleteTransaction?: boolean) {
    if (!query.data || pending || conflict || unavailable) return;
    if (query.data.converted_transaction_id && deleteTransaction === undefined) {
      setDeleteDialog(true);
      return;
    }
    if (!query.data.converted_transaction_id && !window.confirm(`Delete “${query.data.name}”? It will disappear from Events and suggestions. Its stored data is retained, but there is no restore option in this version.`)) return;
    setError("");
    try {
      await remove.mutateAsync({ id, version: query.data.version, ...(deleteTransaction === undefined ? {} : { deleteTransaction }) });
      setDeleteDialog(false);
      navigate(back, { replace: true });
    }
    catch (e) {
      if (e instanceof EventsApiError && e.status === 404) {
        await qc.cancelQueries({ queryKey: eventKeys.detail(id) }); qc.removeQueries({ queryKey: eventKeys.detail(id) });
        await qc.invalidateQueries({ queryKey: eventKeys.lists });
        navigate(back, { replace: true, state: { eventNotice: "This event was already unavailable." } });
      } else failure(e);
    }
  }
  async function copy(e: React.FormEvent) {
    e.preventDefault(); if (pending) return;
    setError("");
    try { const result = await duplicate.mutateAsync({ id, name: copyName.trim() || undefined, target_date: copyDate || undefined }); navigate(`/events/${result.id}/edit`, { state: location.state }); }
    catch (e) { failure(e, true); }
  }
  async function submitConversion(e: React.FormEvent) {
    e.preventDefault();
    if (!query.data || !convertDate || convert.isPending) return;
    setError("");
    try {
      await convert.mutateAsync({ id, body: { version: query.data.version, date: convertDate, section: convertSection } });
      setConvertForm(false);
    } catch (e) {
      failure(e);
    }
  }
  async function reload() {
    const result = await query.refetch();
    if (result.error) failure(result.error); else { setConflict(false); setError(""); }
  }
  const event = query.data;
  return <div className="content fade-in events-page">
    <Link className="btn btn-soft" to={back}>← All events</Link>
    {!event ? query.isPending ? <p>Loading event…</p> : <div role="alert"><p>{query.error instanceof EventsApiError && query.error.status === 404 ? "This event is no longer available." : "Could not load this event."}</p><button className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></div> : <>
      <div className="page-head"><div><h1 className="page-title">{event.name}</h1><p className="page-sub">{event.target_date ? `Flexible date · ${prettyDate(event.target_date)}` : "No date"}</p></div><EventStatusChip status={event.status} /></div>
      <p className="muted event-accounting">{eventAccountingNote}</p>
      {error && <p className="err-msg" role="alert">{error}</p>}
      {conflict && <button className="btn btn-soft" onClick={() => void reload()} disabled={query.isFetching}>Reload latest event</button>}
      <div className="event-actions event-detail-actions">
        <button className="btn btn-primary" disabled={pending || conflict || unavailable} onClick={() => navigate(`/events/${id}/edit`, { state: location.state })}>Edit event</button>
        {event.status === "completed" && !event.converted_transaction_id && <button className="btn btn-soft" disabled={pending || conflict || unavailable || event.summary.actual_total > TRANSACTION_MAX} title={event.summary.actual_total > TRANSACTION_MAX ? "Actual total exceeds the maximum transaction amount." : undefined} onClick={() => { setConvertDate(event.target_date ?? ""); setConvertForm(true); }}>Convert to Transaction</button>}
        <button className="btn btn-soft" disabled={pending || conflict || unavailable} onClick={() => setCopyForm(v => !v)}>Duplicate</button>
        <button className="btn btn-ghost event-danger" disabled={pending || conflict || unavailable} onClick={() => void deleteCurrent()}>Delete event</button>
      </div>
      {deleteDialog && event.converted_transaction_id && <div className="card card-pad event-delete-dialog" role="dialog" aria-label="Delete converted event">
        <h2 className="card-h">This event has a transaction</h2>
        <p className="muted">Choose what to remove. Keeping the transaction preserves it in your records; deleting both removes it from cash flow.</p>
        <div className="event-actions">
          <button className="btn btn-soft" disabled={pending} onClick={() => void deleteCurrent(false)}>Delete event, keep transaction</button>
          <button className="btn btn-ghost event-danger" disabled={pending} onClick={() => void deleteCurrent(true)}>Delete event and transaction</button>
          <button className="btn btn-ghost" disabled={pending} onClick={() => setDeleteDialog(false)}>Cancel</button>
        </div>
      </div>}
      {event.status === "completed" && !event.converted_transaction_id && event.summary.actual_total > TRANSACTION_MAX && <p className="muted">This event total exceeds the maximum amount supported by one transaction.</p>}
      {event.converted_transaction_id && <p className="event-converted" role="status">Added to Transactions.</p>}
      {convertForm && <form className="card card-pad event-convert-form" role="dialog" aria-label="Convert event to transaction" onSubmit={submitConversion}>
        <h2 className="card-h">Convert to Transaction</h2>
        <p className="muted">Creates one cash transaction for {money2(event.summary.actual_total)}.</p>
        <fieldset disabled={convert.isPending || conflict || unavailable} className="event-fieldset event-meta-grid">
          <div className="field"><label htmlFor="convert-date">Transaction date</label><input id="convert-date" className="input" type="date" required value={convertDate} onChange={e => setConvertDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="convert-section">Section</label><select id="convert-section" className="input" value={convertSection} onChange={e => setConvertSection(e.target.value as ConvertSection)}>{CONVERT_SECTIONS.map(s => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}</select></div>
          <div className="event-actions"><button type="submit" className="btn btn-primary" disabled={!convertDate || convert.isPending}>{convert.isPending ? "Converting…" : "Add transaction"}</button><button type="button" className="btn btn-ghost" onClick={() => setConvertForm(false)}>Cancel</button></div>
        </fieldset>
      </form>}
      {copyForm && <form className="card card-pad event-copy-form" aria-label="Duplicate event" onSubmit={copy}><h2 className="card-h">Duplicate event</h2><p className="muted">Copies items, estimates, note and suggestion preference. The copy is Planned, with no actual costs or date unless you choose one.</p><fieldset disabled={pending || conflict || unavailable} className="event-fieldset event-meta-grid"><div className="field"><label htmlFor="copy-name">New name (optional)</label><input id="copy-name" className="input" maxLength={200} value={copyName} onChange={e => setCopyName(e.target.value)} placeholder={`${event.name} (copy)`} autoFocus /></div><div className="field"><label htmlFor="copy-date">New date (optional)</label><input id="copy-date" className="input" type="date" value={copyDate} onChange={e => setCopyDate(e.target.value)} /></div><div className="event-actions"><button type="submit" className="btn btn-primary">{duplicate.isPending ? "Creating copy…" : "Create copy"}</button><button type="button" className="btn btn-ghost" onClick={() => setCopyForm(false)}>Cancel copy</button></div></fieldset></form>}
      <EventSummary summary={event.summary} />
      <section className="card card-pad"><h2 className="card-h">Line items</h2>{!event.items.length ? <p className="muted">No items yet. Edit this event to add estimates.</p> : <div className="event-detail-items"><div className="event-detail-header" aria-hidden="true"><span /><span>Expected cost</span><span>Actual incurred</span></div>{event.items.map(item => <article className="event-detail-item" key={item.id}><h3>{item.name}</h3><p className="num">{item.expected_cost === null ? "Not entered" : money2(item.expected_cost)}</p><p className="num">{item.actual_cost === null ? "Not entered" : money2(item.actual_cost)}</p></article>)}</div>}</section>
      <section className="card card-pad"><h2 className="card-h">Event settings</h2><p>Free-money suggestions: <strong>{event.suggestions_enabled ? "Enabled" : "Disabled"}</strong></p>{event.note && <p className="event-note">{event.note}</p>}
        <div className="event-actions">
          {event.status !== "in_progress" && <button className="btn btn-soft" disabled={pending || conflict || unavailable} onClick={() => void changeStatus("in_progress")}>Start event</button>}
          {event.status !== "completed" && <button className="btn btn-soft" disabled={pending || conflict || unavailable || !event.summary.can_complete} onClick={() => void changeStatus("completed")}>Complete event</button>}
          {event.status !== "cancelled" && <button className="btn btn-ghost" disabled={pending || conflict || unavailable} onClick={() => void changeStatus("cancelled")}>Cancel event</button>}
          {event.status !== "planned" && <button className="btn btn-soft" disabled={pending || conflict || unavailable} onClick={() => void changeStatus("planned")}>Move back to Planned</button>}
        </div>
        {!event.summary.can_complete && <p className="muted">To complete this event, add at least one item and enter every actual cost (0 is allowed). Use Edit event to enter costs.</p>}
      </section>
    </>}
  </div>;
}
