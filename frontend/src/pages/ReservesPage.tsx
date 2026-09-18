import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReserve,
  createReserveDeposit,
  listReserveOperations,
  listReserves,
  renameReserve,
  reserveKeys,
} from "../api/reserves";
import type { Reserve, ReserveDepositInput } from "../types";
import { money2 } from "../lib/money";
import { currentDate } from "../lib/dates";

interface ReserveNameFormProps {
  id: string;
  label: string;
  initialName?: string;
  submitLabel: string;
  submitting: boolean;
  onCancel: () => void;
  onSave: (name: string) => Promise<unknown>;
}

function ReserveNameForm({ id, label, initialName = "", submitLabel, submitting, onCancel, onSave }: ReserveNameFormProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Reserve name is required");
      return;
    }
    setError("");
    try {
      await onSave(trimmed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save reserve");
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={name} maxLength={80} autoFocus aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => setName(event.target.value)} />
      {error && <p id={`${id}-error`} role="alert" className="err-msg">{error}</p>}
      <div className="reserve-actions">
        <button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{submitLabel}</button>
      </div>
    </form>
  );
}

function ReserveCard({ reserve }: { reserve: Reserve }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const rename = useMutation({
    mutationFn: (name: string) => renameReserve(reserve.id, { name }),
    retry: false,
    onSuccess: async () => {
      setRenaming(false);
      await queryClient.invalidateQueries({ queryKey: reserveKeys.all });
    },
  });

  return (
    <article className="card card-pad">
      <div className="reserve-card-head">
        <div><h2 className="card-h">{reserve.name}</h2>{reserve.is_general && <span className="chip chip-cc">General Reserve</span>}</div>
        <strong className="num reserve-balance">{money2(reserve.balance)}</strong>
      </div>
      {renaming ? <div className="reserve-rename"><ReserveNameForm id={`reserve-name-${reserve.id}`} label={`New name for ${reserve.name}`} initialName={reserve.name} submitLabel="Save" submitting={rename.isPending} onCancel={() => setRenaming(false)} onSave={rename.mutateAsync} /></div> :
        <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={() => setRenaming(true)} aria-label={`Rename ${reserve.name}`}>Rename</button></div>}
    </article>
  );
}

interface AllocationDraft { key: number; reserve_id: string; amount: string }

function DepositForm({ reserves, onCancel, onSave, submitting }: {
  reserves: Reserve[];
  onCancel: () => void;
  onSave: (input: ReserveDepositInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(currentDate);
  const [note, setNote] = useState("");
  const [nextKey, setNextKey] = useState(1);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([{ key: 0, reserve_id: reserves[0]?.id ?? "", amount: "" }]);
  const [error, setError] = useState("");
  const amountPattern = /^\d+(?:\.\d{1,2})?$/;
  const total = allocations.reduce((sum, allocation) => sum + (amountPattern.test(allocation.amount) ? Number(allocation.amount) : 0), 0);

  function update(key: number, patch: Partial<AllocationDraft>) {
    setAllocations((current) => current.map((allocation) => allocation.key === key ? { ...allocation, ...patch } : allocation));
  }
  function addAllocation() {
    const used = new Set(allocations.map((allocation) => allocation.reserve_id));
    const reserve = reserves.find((candidate) => !used.has(candidate.id));
    if (!reserve) return;
    setAllocations((current) => [...current, { key: nextKey, reserve_id: reserve.id, amount: "" }]);
    setNextKey((key) => key + 1);
  }
  async function submit() {
    if (!description.trim()) { setError("Description is required"); return; }
    if (!date) { setError("Date is required"); return; }
    if (new Set(allocations.map((allocation) => allocation.reserve_id)).size !== allocations.length) { setError("Choose each reserve only once"); return; }
    if (allocations.some((allocation) => !amountPattern.test(allocation.amount) || Number(allocation.amount) <= 0 || Number(allocation.amount) > 999999999999.99)) {
      setError("Enter a positive amount with no more than two decimal places for every allocation");
      return;
    }
    setError("");
    try {
      await onSave({
        description: description.trim(), date, note: note.trim(),
        allocations: allocations.map((allocation) => ({ reserve_id: allocation.reserve_id, amount: Number(allocation.amount) })),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create reserve deposit");
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="reserve-deposit-fields">
        <div><label htmlFor="deposit-description">Description</label><input id="deposit-description" className="input" autoFocus value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div><label htmlFor="deposit-date">Date</label><input id="deposit-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        <div><label htmlFor="deposit-note">Note (optional)</label><input id="deposit-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      </div>
      <fieldset className="reserve-allocations"><legend>Allocations</legend>
        {allocations.map((allocation, index) => <div className="reserve-allocation" key={allocation.key}>
          <div><label htmlFor={`allocation-reserve-${allocation.key}`}>Reserve {index + 1}</label><select id={`allocation-reserve-${allocation.key}`} className="input" value={allocation.reserve_id} onChange={(event) => update(allocation.key, { reserve_id: event.target.value })}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
          <div><label htmlFor={`allocation-amount-${allocation.key}`}>Amount {index + 1}</label><input id={`allocation-amount-${allocation.key}`} className="input" inputMode="decimal" value={allocation.amount} onChange={(event) => update(allocation.key, { amount: event.target.value })} /></div>
          {allocations.length > 1 && <button type="button" className="btn btn-soft" aria-label={`Remove allocation ${index + 1}`} onClick={() => setAllocations((current) => current.filter((item) => item.key !== allocation.key))}>Remove</button>}
        </div>)}
      </fieldset>
      <div className="reserve-deposit-total">Total allocated: <strong className="num">{money2(total)}</strong></div>
      {error && <p role="alert" className="err-msg">{error}</p>}
      <div className="reserve-actions">
        {allocations.length < reserves.length && <button type="button" className="btn btn-soft" onClick={addAllocation}>Add allocation</button>}
        <button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>Save deposit</button>
      </div>
    </form>
  );
}

export function ReservesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear());
  const [historyReserve, setHistoryReserve] = useState("");
  const query = useQuery({ queryKey: reserveKeys.list(false), queryFn: ({ signal }) => listReserves(false, signal), retry: false });
  const history = useQuery({ queryKey: reserveKeys.operations(historyYear, historyReserve || undefined), queryFn: ({ signal }) => listReserveOperations(historyYear, historyReserve || undefined, signal), retry: false });
  const create = useMutation({ mutationFn: (name: string) => createReserve({ name }), retry: false, onSuccess: async () => { setCreating(false); await queryClient.invalidateQueries({ queryKey: reserveKeys.all }); } });
  const deposit = useMutation({ mutationFn: (input: ReserveDepositInput) => createReserveDeposit(input), retry: false, onSuccess: async () => { setDepositing(false); await queryClient.invalidateQueries({ queryKey: reserveKeys.all }); } });

  if (query.isPending) return <div className="content"><p role="status">Loading reserves…</p></div>;
  if (query.isError) return <div className="content" role="alert"><h1 className="page-title">Reserves</h1><p>Could not load reserves.</p><button type="button" className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></div>;

  const reserves = query.data;
  const aggregate = reserves.reduce((sum, reserve) => sum + reserve.balance, 0);
  return <div className="content fade-in reserves-page">
    <div className="page-head"><div><h1 className="page-title">Reserves</h1><p className="page-sub">Set money aside in a ledger separate from normal spending.</p></div><div className="reserve-head-actions"><button type="button" className="btn btn-soft" disabled={!reserves.length} onClick={() => setDepositing(true)}>Add to reserves</button><button type="button" className="btn btn-primary reserve-create-button" disabled={reserves.length >= 5} onClick={() => setCreating(true)}>Create reserve</button></div></div>
    <section className="card card-pad reserve-summary" aria-labelledby="reserve-total-heading"><p id="reserve-total-heading" className="stat-lbl">Aggregate reserve balance</p><p className="stat-big num">{money2(aggregate)}</p><p className="muted">{reserves.length} of 5 active reserves</p></section>
    {creating && <section className="card card-pad reserve-create" aria-labelledby="create-reserve-heading"><h2 id="create-reserve-heading" className="card-h">Create reserve</h2><ReserveNameForm id="create-reserve-name" label="Reserve name" submitLabel="Save reserve" submitting={create.isPending} onCancel={() => setCreating(false)} onSave={create.mutateAsync} /></section>}
    {depositing && <section className="card card-pad reserve-create" aria-labelledby="deposit-heading"><h2 id="deposit-heading" className="card-h">Add to reserves</h2><DepositForm reserves={reserves} submitting={deposit.isPending} onCancel={() => setDepositing(false)} onSave={deposit.mutateAsync} /></section>}
    {!reserves.length ? <section className="card card-pad"><p>No reserves are available yet.</p></section> : <section aria-label="Active reserves" className="grid reserve-grid">{reserves.map((reserve) => <ReserveCard key={reserve.id} reserve={reserve} />)}</section>}
    <section className="reserve-history" aria-labelledby="reserve-history-heading"><div className="reserve-history-head"><h2 id="reserve-history-heading" className="page-title">Deposit history</h2><div className="reserve-history-filters"><label htmlFor="history-year">Year</label><input id="history-year" className="input" type="number" min="1" max="9998" value={historyYear} onChange={(event) => setHistoryYear(Number(event.target.value) || new Date().getFullYear())} /><label htmlFor="history-reserve">Reserve</label><select id="history-reserve" className="input" value={historyReserve} onChange={(event) => setHistoryReserve(event.target.value)}><option value="">All reserves</option>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div></div>
      {history.isPending ? <p role="status">Loading reserve history…</p> : history.isError ? <div role="alert"><p>Could not load reserve history.</p><button type="button" className="btn btn-soft" onClick={() => void history.refetch()}>Retry history</button></div> : !history.data.length ? <div className="card card-pad"><p>No reserve deposits in {historyYear}.</p></div> : <div className="grid">{history.data.map((operation) => <article className="card card-pad reserve-operation" key={operation.id}><div className="reserve-card-head"><div><span className="chip chip-paid">Sent to reserves</span><h3>{operation.description}</h3><p className="muted">{operation.date}{operation.note ? ` · ${operation.note}` : ""}</p></div><strong className="num reserve-balance">{money2(operation.total)}</strong></div><ul>{operation.entries.map((entry) => <li key={entry.id}>{entry.reserve_name} · <span className="num">{money2(entry.amount)}</span></li>)}</ul></article>)}</div>}
    </section>
  </div>;
}
