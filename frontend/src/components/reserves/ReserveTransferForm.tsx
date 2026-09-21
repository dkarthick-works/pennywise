import { useState } from "react";
import type { Reserve, ReserveTransferInput } from "../../types";
import { currentDate } from "../../lib/dates";
import { money2 } from "../../lib/money";

export function ReserveTransferForm({ reserves, initialFromReserveId, onCancel, onSave, submitting }: {
  reserves: Reserve[];
  initialFromReserveId?: string;
  onCancel: () => void;
  onSave: (input: ReserveTransferInput) => Promise<unknown>;
  submitting: boolean;
}) {
  const initialFrom = reserves.find((reserve) => reserve.id === initialFromReserveId) ?? reserves[0];
  const [from, setFrom] = useState(initialFrom?.id ?? "");
  const [to, setTo] = useState(reserves.find((reserve) => reserve.id !== initialFrom?.id)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(currentDate());
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const amountPattern = /^\d+(?:\.\d{1,2})?$/;

  async function submit() {
    if (!from || !to || from === to) { setError("Choose two different reserves"); return; }
    if (!amountPattern.test(amount) || Number(amount) <= 0) { setError("Enter a positive amount with no more than two decimal places"); return; }
    if (!date) { setError("Date is required"); return; }
    setError("");
    try { await onSave({ from_reserve_id: from, to_reserve_id: to, amount: Number(amount), date, note: note.trim() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create reserve transfer"); }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="reserve-spending-fields">
      <div><label htmlFor="transfer-from">From reserve</label><select id="transfer-from" className="input" value={from} onChange={(event) => setFrom(event.target.value)}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
      <div><label htmlFor="transfer-to">To reserve</label><select id="transfer-to" className="input" value={to} onChange={(event) => setTo(event.target.value)}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
      <div><label htmlFor="transfer-amount">Amount</label><input id="transfer-amount" className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div><label htmlFor="transfer-date">Date</label><input id="transfer-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div><label htmlFor="transfer-note">Note (optional)</label><input id="transfer-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </div>
    {amountPattern.test(amount) && Number(amount) > 0 && <p className="reserve-deposit-total">Transfer: <strong className="num">{money2(Number(amount))}</strong></p>}
    {error && <p role="alert" className="err-msg">{error}</p>}
    <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>Save transfer</button></div>
  </form>;
}
