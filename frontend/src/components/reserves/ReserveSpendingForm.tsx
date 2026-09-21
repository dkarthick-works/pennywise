import { useState } from "react";
import type { Reserve, ReserveSpendingInput } from "../../types";
import { currentDate } from "../../lib/dates";
import { money2 } from "../../lib/money";

export function ReserveSpendingForm({ reserves, initial, onCancel, onSave, submitting }: {
  reserves: Reserve[];
  initial?: Partial<ReserveSpendingInput>;
  onCancel: () => void;
  onSave: (input: ReserveSpendingInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const [reserveId, setReserveId] = useState(initial?.reserve_id ?? reserves[0]?.id ?? "");
  const [amount, setAmount] = useState(initial?.amount === undefined ? "" : String(initial.amount));
  const [date, setDate] = useState(initial?.date ?? currentDate());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const amountPattern = /^\d+(?:\.\d{1,2})?$/;

  async function submit() {
    if (!reserveId) { setError("Choose a reserve"); return; }
    if (!amountPattern.test(amount) || Number(amount) <= 0) { setError("Enter a positive amount with no more than two decimal places"); return; }
    if (!date) { setError("Date is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    setError("");
    try {
      await onSave({ reserve_id: reserveId, amount: Number(amount), date, description: description.trim(), note: note.trim() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save reserve spending");
    }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="reserve-spending-fields">
      <div><label htmlFor="spending-reserve">Reserve</label><select id="spending-reserve" className="input" value={reserveId} onChange={(event) => setReserveId(event.target.value)}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
      <div><label htmlFor="spending-amount">Amount</label><input id="spending-amount" className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div><label htmlFor="spending-date">Date</label><input id="spending-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div><label htmlFor="spending-description">Description</label><input id="spending-description" className="input" autoFocus value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div><label htmlFor="spending-note">Note (optional)</label><input id="spending-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </div>
    {amountPattern.test(amount) && Number(amount) > 0 && <p className="reserve-deposit-total">Withdraw: <strong className="num">{money2(Number(amount))}</strong></p>}
    {error && <p role="alert" className="err-msg">{error}</p>}
    <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>Save spending</button></div>
  </form>;
}
