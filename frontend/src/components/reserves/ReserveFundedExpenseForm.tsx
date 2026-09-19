import { useState } from "react";
import type { FundedExpenseInput, Reserve } from "../../types";
import { currentDate } from "../../lib/dates";
import { money2 } from "../../lib/money";

export function ReserveFundedExpenseForm({ reserves, onCancel, onSave, submitting }: { reserves: Reserve[]; onCancel: () => void; onSave: (input: FundedExpenseInput) => Promise<unknown>; submitting: boolean }) {
  const [reserveId, setReserveId] = useState(reserves[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(currentDate());
  const [section, setSection] = useState<FundedExpenseInput["section"]>("daily");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const amountPattern = /^\d+(?:\.\d{1,2})?$/;
  const input = { reserve_id: reserveId, amount: Number(amount), date, section, category: category.trim(), note: note.trim() };
  function validate() {
    if (!reserveId || !amountPattern.test(amount) || Number(amount) <= 0 || !date || !category.trim()) { setError("Enter a reserve, positive amount, date, and expense category"); return false; }
    setError(""); return true;
  }
  async function submit() { if (!validate()) return; if (!review) { setReview(true); return; } try { await onSave(input); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create funded expense"); } }
  if (review) return <div className="funded-expense-confirm"><p><strong>This cannot be edited after creation.</strong></p><ul><li>Withdraw from {reserves.find((reserve) => reserve.id === reserveId)?.name}: {money2(input.amount)}</li><li>Create normal income: {money2(input.amount)}</li><li>Create {section} cash expense: {category}</li></ul><div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={() => setReview(false)}>Back</button><button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void submit()}>Confirm and save</button></div></div>;
  return <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="muted">This creates normal income and a matching cash expense. Both affect existing analytics and are deleted together.</p>
    <div className="reserve-spending-fields">
      <div><label htmlFor="funded-reserve">Reserve</label><select id="funded-reserve" className="input" value={reserveId} onChange={(event) => setReserveId(event.target.value)}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name}</option>)}</select></div>
      <div><label htmlFor="funded-amount">Amount</label><input id="funded-amount" className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      <div><label htmlFor="funded-date">Date</label><input id="funded-date" className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
      <div><label htmlFor="funded-section">Expense section</label><select id="funded-section" className="input" value={section} onChange={(event) => setSection(event.target.value as FundedExpenseInput["section"])}><option value="essential">Essential</option><option value="flexible">Flexible</option><option value="daily">Daily</option></select></div>
      <div><label htmlFor="funded-category">Expense category</label><input id="funded-category" className="input" autoFocus value={category} onChange={(event) => setCategory(event.target.value)} /></div>
      <div><label htmlFor="funded-note">Note (optional)</label><input id="funded-note" className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
    </div>
    {error && <p role="alert" className="err-msg">{error}</p>}
    <div className="reserve-actions"><button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={submitting}>Review and save</button></div>
  </form>;
}
