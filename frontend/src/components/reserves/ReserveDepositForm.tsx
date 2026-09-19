import { useState } from "react";
import type { Reserve, ReserveDepositInput, ReserveOperation } from "../../types";
import { currentDate } from "../../lib/dates";
import { money2 } from "../../lib/money";

interface AllocationDraft { key: number; reserve_id: string; amount: string }

export function ReserveDepositForm({ reserves, onCancel, onSave, submitting, initialDate = currentDate(), initial, expectedTotal }: {
  reserves: Reserve[];
  onCancel: () => void;
  onSave: (input: ReserveDepositInput) => Promise<unknown>;
  submitting: boolean;
  initialDate?: string;
  initial?: ReserveOperation;
  expectedTotal?: number;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [date, setDate] = useState(initial?.date ?? initialDate);
  const [note, setNote] = useState(initial?.note ?? "");
  const [nextKey, setNextKey] = useState(initial?.entries.length ?? 1);
  const [allocations, setAllocations] = useState<AllocationDraft[]>(() => initial?.entries.length ? initial.entries.map((entry, key) => ({ key, reserve_id: entry.reserve_id, amount: String(entry.amount) })) : [{ key: 0, reserve_id: reserves[0]?.id ?? "", amount: "" }]);
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
    if (expectedTotal !== undefined && Math.round(total * 100) !== Math.round(expectedTotal * 100)) {
      setError("Allocation total must equal the full income amount");
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
