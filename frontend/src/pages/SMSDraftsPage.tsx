import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { Link } from "react-router-dom";
import {
  approveSMSDraft, ignoreSMSDraft, listFailedSMSJobs, listSMSDrafts, retrySMSJob, saveSMSDraft,
  type SMSDraft, type SMSDraftValues, type SMSJob,
} from "../api/sms";
import { invalidateAllTransactionCaches, invalidateMonthCaches, invalidateTransactionNameSuggestions } from "../lib/monthCaches";
import "./sms-drafts.css";

const warningText: Record<string, string> = {
  possible_settlement_review: "Possible card bill payment. Saving this as spending can count the purchase twice. Ignore it if you already recorded the purchase.",
  card_mapped_to_credit: "The SMS mentions a card. Credit was suggested, including for debit cards. Check the payment kind.",
  cash_defaulted: "No explicit card payment was found. Cash was suggested.",
  incoming_credit_review: "An incoming credit is not always income. Check the section before approval.",
  refund_review: "Possible refund. Check how this should be recorded before approval.",
  transfer_review: "Possible transfer between accounts. Saving this as income or spending can distort your totals.",
  currency_defaulted: "No currency was stated. Your ledger currency was used.",
};
function reviewError(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data;
    if (Array.isArray(data?.issues)) return data.issues.map((i: { message: string }) => i.message).join(". ");
    if (typeof data?.error === "string") return data.error;
  }
  return "Could not complete the action. Your edits are still here. Check your connection and try again.";
}
function initialValues(draft: SMSDraft): SMSDraftValues {
  return { section: draft.section ?? "", category: draft.category, amount: String(draft.amount), date: draft.date, kind: draft.kind };
}

function DraftReview({ draft: incomingDraft, onDone }: { draft: SMSDraft; onDone: (message: string) => void }) {
  const qc = useQueryClient();
  // Keep the revision the user actually reviewed. A list refresh must neither
  // erase unsaved edits nor silently approve them against a newer revision.
  const [draft, setDraft] = useState(incomingDraft);
  const [values, setValues] = useState(() => initialValues(draft));
  const [error, setError] = useState("");
  const [confirmIgnore, setConfirmIgnore] = useState(false);
  const busy = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initialValues(draft));
  const leaveGuard = useRef(dirty);
  leaveGuard.current = dirty;
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (leaveGuard.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: Event) => { if (leaveGuard.current && !window.confirm("Discard unsaved draft edits?")) event.preventDefault(); };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("events:before-navigate", navigate);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener("events:before-navigate", navigate); };
  }, []);
  const action = useMutation({
    mutationFn: async (mode: "save" | "approve" | "ignore") => {
      if (mode === "save") await saveSMSDraft(draft, values);
      if (mode === "ignore") await ignoreSMSDraft(draft);
      if (mode === "approve") {
        const transaction = await approveSMSDraft(draft, values);
        invalidateMonthCaches(qc, transaction.date.slice(0, 7));
        invalidateAllTransactionCaches(qc);
        invalidateTransactionNameSuggestions(qc, transaction.section);
      }
      return mode;
    },
    onSuccess: async (mode) => {
      leaveGuard.current = false;
      if (mode === "save") {
        const saved = { ...draft, ...values, section: values.section || null, amount: Number(values.amount), revision: draft.revision + 1 };
        setDraft(saved); setValues(initialValues(saved));
      }
      onDone(mode === "approve" ? "Transaction saved to your ledger." : mode === "ignore" ? "Draft ignored. No Transaction was created." : "Draft edits saved. Nothing was added to your ledger.");
      await qc.invalidateQueries({ queryKey: ["sms-drafts"] });
    },
    onError: (err) => setError(reviewError(err)),
    onSettled: () => { busy.current = false; },
  });
  function submit(mode: "save" | "approve" | "ignore") {
    if (busy.current) return;
    setError("");
    if (mode !== "ignore") {
      if (!values.category.trim() || !values.date || !/^\d{1,12}(\.\d{1,2})?$/.test(values.amount) || Number(values.amount) <= 0) {
        setError("Enter a name, a valid date, and an amount greater than zero with up to two decimal places."); return;
      }
      if (mode === "approve" && !values.section) { setError("Choose a section before approval."); return; }
      if (values.section === "income" && values.kind !== "cash") { setError("Income must use Cash. Change the payment kind before saving."); return; }
    }
    busy.current = true;
    action.mutate(mode);
  }
  function field<K extends keyof SMSDraftValues>(key: K, value: SMSDraftValues[K]) { setValues((old) => ({ ...old, [key]: value })); }
  const prefix = `sms-${draft.id}`;
  return <article className="sms-review" aria-labelledby={`${prefix}-title`}>
    <h2 id={`${prefix}-title`}>{draft.category}</h2>
    <p className="sms-meta">{draft.date} · {draft.currency} · {draft.direction === "credit" ? "Incoming" : "Outgoing"} · {draft.event_type.replaceAll("_", " ")}</p>
    {(incomingDraft.revision === draft.revision ? incomingDraft.possible_duplicate : draft.possible_duplicate) && <p className="sms-warning">Possible duplicate: a saved Transaction has the same date and amount as this draft. Check your ledger before approval.</p>}
    {draft.warnings.filter((code) => code !== "section_required" && code !== "section_suggested").length > 0 && <ul className="sms-warnings">
      {draft.warnings.filter((code) => code !== "section_required" && code !== "section_suggested").map((code) => <li key={code}>{warningText[code] ?? "Check this draft carefully before approval."}</li>)}
    </ul>}
    {incomingDraft.revision > draft.revision && <div className="sms-warning" role="status">
      This draft has a newer version. Your edits are still here. Load the latest version before continuing.
      <button className="btn btn-soft" type="button" disabled={action.isPending} onClick={() => {
        if (dirty && !window.confirm("Discard your edits and load the latest draft?")) return;
        setDraft(incomingDraft); setValues(initialValues(incomingDraft)); setError("");
      }}>Load latest draft</button>
    </div>}
    <form onSubmit={(event) => { event.preventDefault(); submit("approve"); }}>
      <fieldset disabled={action.isPending}>
        <legend className="sr-only">Edit {draft.category}</legend>
        <div className="sms-fields">
          <label className="sms-name" htmlFor={`${prefix}-name`}>Transaction name<input className="input" id={`${prefix}-name`} value={values.category} maxLength={200} required onChange={(e) => field("category", e.target.value)} /></label>
          <label htmlFor={`${prefix}-date`}>Date<input className="input" id={`${prefix}-date`} type="date" value={values.date} required onChange={(e) => field("date", e.target.value)} /></label>
          <label htmlFor={`${prefix}-amount`}>Amount ({draft.currency})<input className="input" id={`${prefix}-amount`} inputMode="decimal" value={values.amount} required onChange={(e) => field("amount", e.target.value)} /></label>
          <label htmlFor={`${prefix}-section`}><span id={`${prefix}-section-label`}>Section</span><select className="input" aria-labelledby={`${prefix}-section-label`} id={`${prefix}-section`} value={values.section} onChange={(e) => field("section", e.target.value as SMSDraftValues["section"])}>
            <option value="">Choose a section</option><option value="daily">Daily / Running</option><option value="essential">Bare Minimum</option><option value="flexible">Subscriptions</option><option value="income">Income</option>
          </select></label>
          <label htmlFor={`${prefix}-kind`}><span id={`${prefix}-kind-label`}>Payment kind</span><select className="input" aria-labelledby={`${prefix}-kind-label`} id={`${prefix}-kind`} value={values.kind} onChange={(e) => field("kind", e.target.value as SMSDraftValues["kind"])}><option value="cash">Cash</option><option value="credit">Credit</option></select></label>
        </div>
        <p className="sms-meta">Sections are AI suggestions. Confirm the section and payment kind yourself.</p>
        {error && <p className="sms-error" role="alert">{error}</p>}
        <div className="sms-actions">
          <button className="btn btn-primary" type="submit">{action.isPending && action.variables === "approve" ? "Approving…" : "Approve and save Transaction"}</button>
          <button className="btn btn-soft" type="button" disabled={!dirty} onClick={() => submit("save")}>{action.isPending && action.variables === "save" ? "Saving…" : "Save draft edits"}</button>
          <button className="btn btn-ghost" type="button" onClick={() => setConfirmIgnore(true)}>Ignore</button>
        </div>
        {confirmIgnore && <div className="sms-ignore">
          <p>Ignore this draft? It will leave the review list. No Transaction will be created.</p>
          <button className="btn btn-soft" type="button" onClick={() => submit("ignore")}>Confirm ignore</button>{" "}
          <button className="btn btn-ghost" type="button" onClick={() => setConfirmIgnore(false)}>Keep draft</button>
        </div>}
      </fieldset>
    </form>
  </article>;
}
function FailedJob({ job }: { job: SMSJob }) {
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => retrySMSJob(job.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["sms-failures"] }) });
  return <li className="sms-failure">
    <div><strong>{job.failed_stage === "extraction" ? "Extraction" : "Verification"} failed</strong><p className="sms-meta">Job {job.id.slice(0, 8)} · {job.error_code.replaceAll("_", " ")}. Retry resumes this stage only.</p>
      {retry.isError && <p role="alert">{reviewError(retry.error)}</p>}
    </div>
    <button className="btn btn-soft" disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? "Queuing…" : "Retry"}</button>
  </li>;
}
export function SMSDraftsPage() {
  const [notice, setNotice] = useState("");
  const drafts = useInfiniteQuery({ queryKey: ["sms-drafts"], queryFn: ({ pageParam }) => listSMSDrafts(pageParam), initialPageParam: 0, getNextPageParam: (last) => last.next_offset ?? undefined, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const failures = useInfiniteQuery({ queryKey: ["sms-failures"], queryFn: ({ pageParam }) => listFailedSMSJobs(pageParam), initialPageParam: 0, getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined });
  const items = drafts.data?.pages.flatMap((page) => page.drafts) ?? [];
  const jobs = failures.data?.pages.flat() ?? [];
  function refresh() {
    if (!window.dispatchEvent(new Event("events:before-navigate", { cancelable: true }))) return;
    void drafts.refetch(); void failures.refetch();
  }
  return <div className="content sms-drafts">
    <div className="page-head"><div><h1 className="page-title">SMS Drafts</h1><p className="page-sub">Review one draft at a time. Only approval adds a Transaction to your ledger.</p></div><button className="btn btn-soft" disabled={drafts.isFetching} onClick={refresh}>Refresh</button></div>
    <p className="sms-meta">Android uploads eligible SMS. Backend AI must be enabled to create drafts. <Link to="/settings" onClick={(event) => { if (!window.dispatchEvent(new Event("events:before-navigate", { cancelable: true }))) event.preventDefault(); }}>Manage SMS devices</Link></p>
    <p role="status" className="sms-notice">{notice}</p>
    {drafts.isPending && <p role="status">Loading SMS drafts…</p>}
    {drafts.isError && <p role="alert">Could not load drafts. Check your connection, then select Refresh. Your edits have not been saved automatically.</p>}
    {drafts.isSuccess && items.length === 0 && <section className="sms-empty"><h2>No drafts to review</h2><p>New drafts appear here after SMS processing. Rejected messages do not enter this list.</p><p>Scan from Android SMS settings, then refresh this page.</p></section>}
    {items.map((draft) => <DraftReview key={draft.id} draft={draft} onDone={setNotice} />)}
    {drafts.hasNextPage && <button className="btn btn-soft" disabled={drafts.isFetchingNextPage} onClick={() => void drafts.fetchNextPage()}>Load more drafts</button>}
    <section className="sms-failures" aria-labelledby="sms-failures-heading"><h2 id="sms-failures-heading">Processing failures</h2><p className="sms-meta">Retry is available while the source message is retained and SMS consent is active.</p>
      {failures.isPending && <p>Loading processing failures…</p>}
      {failures.isError && <p role="alert">Could not load processing failures. <button className="btn btn-soft" onClick={() => void failures.refetch()}>Retry loading</button></p>}
      {failures.isSuccess && jobs.length === 0 && <p>No failed jobs.</p>}
      <ul>{jobs.map((job) => <FailedJob key={job.id} job={job} />)}</ul>
      {failures.hasNextPage && <button className="btn btn-soft" disabled={failures.isFetchingNextPage} onClick={() => void failures.fetchNextPage()}>Load more failures</button>}
    </section>
  </div>;
}
