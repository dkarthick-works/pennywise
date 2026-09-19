import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createReserve,
  createReserveDeposit,
  createReserveSpending,
  deleteReserveSpending,
  listReserveOperations,
  listReserves,
  renameReserve,
  reserveKeys,
  updateReserveSpending,
} from "../api/reserves";
import type { Reserve, ReserveDepositInput } from "../types";
import { ReserveDepositForm } from "../components/reserves/ReserveDepositForm";
import { ReserveSpendingForm } from "../components/reserves/ReserveSpendingForm";
import type { ReserveOperation, ReserveSpendingInput } from "../types";
import { money2 } from "../lib/money";

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

export function ReservesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [spending, setSpending] = useState(false);
  const [editingSpending, setEditingSpending] = useState<ReserveOperation | null>(null);
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear());
  const [historyReserve, setHistoryReserve] = useState("");
  const query = useQuery({ queryKey: reserveKeys.list(false), queryFn: ({ signal }) => listReserves(false, signal), retry: false });
  const history = useQuery({ queryKey: reserveKeys.operations(historyYear, historyReserve || undefined), queryFn: ({ signal }) => listReserveOperations(historyYear, historyReserve || undefined, signal), retry: false });
  async function invalidateReserveData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: reserveKeys.all }),
      queryClient.invalidateQueries({ queryKey: reserveKeys.operationsForYear(historyYear) }),
    ]);
  }
  const create = useMutation({ mutationFn: (name: string) => createReserve({ name }), retry: false, onSuccess: async () => { setCreating(false); await invalidateReserveData(); } });
  const deposit = useMutation({ mutationFn: (input: ReserveDepositInput) => createReserveDeposit(input), retry: false, onSuccess: async () => { setDepositing(false); await invalidateReserveData(); } });
  const spend = useMutation({ mutationFn: (input: ReserveSpendingInput) => createReserveSpending(input), retry: false, onSuccess: async () => { setSpending(false); await invalidateReserveData(); } });
  const updateSpend = useMutation({ mutationFn: ({ id, input }: { id: string; input: ReserveSpendingInput }) => updateReserveSpending(id, input), retry: false, onSuccess: async () => { setEditingSpending(null); await invalidateReserveData(); } });
  const deleteSpend = useMutation({ mutationFn: (id: string) => deleteReserveSpending(id), retry: false, onSuccess: async () => { await invalidateReserveData(); } });

  if (query.isPending) return <div className="content"><p role="status">Loading reserves…</p></div>;
  if (query.isError) return <div className="content" role="alert"><h1 className="page-title">Reserves</h1><p>Could not load reserves.</p><button type="button" className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button></div>;

  const reserves = query.data;
  const aggregate = reserves.reduce((sum, reserve) => sum + reserve.balance, 0);
  return <div className="content fade-in reserves-page">
    <div className="page-head"><div><h1 className="page-title">Reserves</h1><p className="page-sub">Set money aside in a ledger separate from normal spending.</p></div><div className="reserve-head-actions"><button type="button" className="btn btn-soft" disabled={!reserves.length} onClick={() => setDepositing(true)}>Add to reserves</button><button type="button" className="btn btn-soft" disabled={!reserves.length} onClick={() => setSpending(true)}>Record reserve spending</button><button type="button" className="btn btn-primary reserve-create-button" disabled={reserves.length >= 5} onClick={() => setCreating(true)}>Create reserve</button></div></div>
    <section className="card card-pad reserve-summary" aria-labelledby="reserve-total-heading"><p id="reserve-total-heading" className="stat-lbl">Aggregate reserve balance</p><p className="stat-big num">{money2(aggregate)}</p><p className="muted">{reserves.length} of 5 active reserves</p></section>
    {creating && <section className="card card-pad reserve-create" aria-labelledby="create-reserve-heading"><h2 id="create-reserve-heading" className="card-h">Create reserve</h2><ReserveNameForm id="create-reserve-name" label="Reserve name" submitLabel="Save reserve" submitting={create.isPending} onCancel={() => setCreating(false)} onSave={create.mutateAsync} /></section>}
    {depositing && <section className="card card-pad reserve-create" aria-labelledby="deposit-heading"><h2 id="deposit-heading" className="card-h">Add to reserves</h2><ReserveDepositForm reserves={reserves} submitting={deposit.isPending} onCancel={() => setDepositing(false)} onSave={deposit.mutateAsync} /></section>}
    {spending && <section className="card card-pad reserve-create" aria-labelledby="spending-heading"><h2 id="spending-heading" className="card-h">Record reserve spending</h2><ReserveSpendingForm reserves={reserves} submitting={spend.isPending} onCancel={() => setSpending(false)} onSave={spend.mutateAsync} /></section>}
    {editingSpending && <section className="card card-pad reserve-create" aria-labelledby="edit-spending-heading"><h2 id="edit-spending-heading" className="card-h">Edit reserve spending</h2><ReserveSpendingForm key={editingSpending.id} reserves={reserves} submitting={updateSpend.isPending} initial={{ reserve_id: editingSpending.entries[0]?.reserve_id, amount: editingSpending.total, date: editingSpending.date, description: editingSpending.description, note: editingSpending.note }} onCancel={() => setEditingSpending(null)} onSave={(input) => updateSpend.mutateAsync({ id: editingSpending.id, input })} /></section>}
    {!reserves.length ? <section className="card card-pad"><p>No reserves are available yet.</p></section> : <section aria-label="Active reserves" className="grid reserve-grid">{reserves.map((reserve) => <ReserveCard key={reserve.id} reserve={reserve} />)}</section>}
    <section className="reserve-history" aria-labelledby="reserve-history-heading"><div className="reserve-history-head"><h2 id="reserve-history-heading" className="page-title">Reserve history</h2><div className="reserve-history-filters"><label htmlFor="history-year">Year</label><input id="history-year" className="input" type="number" min="1" max="9998" value={historyYear} onChange={(event) => setHistoryYear(Number(event.target.value) || new Date().getFullYear())} /><label htmlFor="history-reserve">Reserve</label><select id="history-reserve" className="input" value={historyReserve} onChange={(event) => setHistoryReserve(event.target.value)}><option value="">All reserves</option>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div></div>
      {history.isPending ? <p role="status">Loading reserve history…</p> : history.isError ? <div role="alert"><p>Could not load reserve history.</p><button type="button" className="btn btn-soft" onClick={() => void history.refetch()}>Retry history</button></div> : !history.data.length ? <div className="card card-pad"><p>No reserve activity in {historyYear}.</p></div> : <div className="grid">{history.data.map((operation) => <article className="card card-pad reserve-operation" key={operation.id}>
        <div className="reserve-card-head"><div><span className="chip chip-paid">{operation.operation_type === "reserve_spend" ? "Reserve spending" : "Sent to reserves"}</span><h3>{operation.description}</h3><p className="muted">{operation.date}{operation.note ? ` · ${operation.note}` : ""}</p></div><strong className="num reserve-balance">{operation.operation_type === "reserve_spend" ? "−" : ""}{money2(operation.total)}</strong></div>
        <ul>{operation.entries.map((entry) => <li key={entry.id}>{entry.reserve_name} · <span className="num">{operation.operation_type === "reserve_spend" ? "−" : ""}{money2(entry.amount)}</span></li>)}</ul>
        {operation.editable && <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={() => setEditingSpending(operation)}>Edit</button>{operation.deletable && <button type="button" className="btn btn-soft" onClick={() => { if (window.confirm("Delete this reserve spending?")) deleteSpend.mutate(operation.id); }}>Delete</button>}</div>}
      </article>)}</div>}
    </section>
  </div>;
}
