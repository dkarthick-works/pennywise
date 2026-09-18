import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createReserve, listReserves, renameReserve, reserveKeys } from "../api/reserves";
import type { Reserve } from "../types";
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
      <input
        id={id}
        className="input"
        value={name}
        maxLength={80}
        autoFocus
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setName(event.target.value)}
      />
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
        <div>
          <h2 className="card-h">{reserve.name}</h2>
          {reserve.is_general && <span className="chip chip-cc">General Reserve</span>}
        </div>
        <strong className="num reserve-balance">{money2(reserve.balance)}</strong>
      </div>
      {renaming ? (
        <div className="reserve-rename">
          <ReserveNameForm
            id={`reserve-name-${reserve.id}`}
            label={`New name for ${reserve.name}`}
            initialName={reserve.name}
            submitLabel="Save"
            submitting={rename.isPending}
            onCancel={() => setRenaming(false)}
            onSave={rename.mutateAsync}
          />
        </div>
      ) : (
        <div className="reserve-actions">
          <button type="button" className="btn btn-soft" onClick={() => setRenaming(true)} aria-label={`Rename ${reserve.name}`}>Rename</button>
        </div>
      )}
    </article>
  );
}

export function ReservesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: reserveKeys.list(false),
    queryFn: ({ signal }) => listReserves(false, signal),
    retry: false,
  });
  const create = useMutation({
    mutationFn: (name: string) => createReserve({ name }),
    retry: false,
    onSuccess: async () => {
      setCreating(false);
      await queryClient.invalidateQueries({ queryKey: reserveKeys.all });
    },
  });

  if (query.isPending) return <div className="content"><p role="status">Loading reserves…</p></div>;
  if (query.isError) return (
    <div className="content" role="alert">
      <h1 className="page-title">Reserves</h1>
      <p>Could not load reserves.</p>
      <button type="button" className="btn btn-soft" onClick={() => void query.refetch()}>Retry</button>
    </div>
  );

  const reserves = query.data;
  const aggregate = reserves.reduce((sum, reserve) => sum + reserve.balance, 0);

  return (
    <div className="content fade-in reserves-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reserves</h1>
          <p className="page-sub">Set money aside in a ledger separate from normal spending.</p>
        </div>
        <button type="button" className="btn btn-primary reserve-create-button" disabled={reserves.length >= 5} onClick={() => setCreating(true)}>Create reserve</button>
      </div>

      <section className="card card-pad reserve-summary" aria-labelledby="reserve-total-heading">
        <p id="reserve-total-heading" className="stat-lbl">Aggregate reserve balance</p>
        <p className="stat-big num">{money2(aggregate)}</p>
        <p className="muted">{reserves.length} of 5 active reserves</p>
      </section>

      {creating && (
        <section className="card card-pad reserve-create" aria-labelledby="create-reserve-heading">
          <h2 id="create-reserve-heading" className="card-h">Create reserve</h2>
          <ReserveNameForm
            id="create-reserve-name"
            label="Reserve name"
            submitLabel="Save reserve"
            submitting={create.isPending}
            onCancel={() => setCreating(false)}
            onSave={create.mutateAsync}
          />
        </section>
      )}

      {!reserves.length ? (
        <section className="card card-pad"><p>No reserves are available yet.</p></section>
      ) : (
        <section aria-label="Active reserves" className="grid reserve-grid">
          {reserves.map((reserve) => <ReserveCard key={reserve.id} reserve={reserve} />)}
        </section>
      )}
    </div>
  );
}
