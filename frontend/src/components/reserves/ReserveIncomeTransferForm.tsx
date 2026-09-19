import { useState } from "react";
import type { Reserve, ReserveIncomeTransferInput } from "../../types";
import { currentDate } from "../../lib/dates";
import { money2 } from "../../lib/money";

export function ReserveIncomeTransferForm({ reserves, onCancel, onSave, submitting }: { reserves: Reserve[]; onCancel: () => void; onSave: (input: ReserveIncomeTransferInput) => Promise<unknown>; submitting: boolean }) {
  const [reserveId, setReserveId] = useState(reserves[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(currentDate());
  const [description, setDescription] = useState(() => reserves[0] ? `From ${reserves[0].name}` : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const amountPattern = /^\d+(?:\.\d{1,2})?$/;
  async function submit() {
    if (!reserveId) { setError("Choose a reserve"); return; }
    if (!amountPattern.test(amount) || Number(amount) <= 0) { setError("Enter a positive amount with no more than two decimal places"); return; }
    if (!date) { setError("Date is required"); return; }
    if (!description.trim()) { setError("Description is required"); return; }
    setError("");
    try { await onSave({ reserve_id: reserveId, amount: Number(amount), date, description: description.trim(), note: note.trim() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not move reserve money to income"); }
  }
  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="muted">This creates normal income and affects income calculations.</p>
    <div className="reserve-spending-fields">
      <div><label htmlFor="income-transfer-reserve">Reserve</label><select id="income-transfer-reserve" className="input" value={reserveId} onChange={(event) => { const id = event.target.value; setReserveId(id); const reserve = reserves.find((item) => item.id === id); if (reserve) setDescription(`From ${reserve.name}`); }}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
      <div><label htmlFor="income-transfer-amount">Amount</label><input id="income-transfer-amount" className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div><label htmlFor="income-transfer-date">Date</label><input id="income-transfer-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div><label htmlFor="income-transfer-description">Description</label><input id="income-transfer-description" className="input" autoFocus value={description} onChange={(event) => setDescription(event.target.value)} /></div>
      <div><label htmlFor="income-transfer-note">Note (optional)</label><input id="income-transfer-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </div>
    {amountPattern.test(amount) && Number(amount) > 0 && <p className="reserve-deposit-total">Create normal income: <strong className="num">{money2(Number(amount))}</strong></p>}
    {error && <p role="alert" className="err-msg">{error}</p>}
    <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>Move to income</button></div>
  </form>;
}
