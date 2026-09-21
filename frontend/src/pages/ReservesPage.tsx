import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveReserve,
  convertIncomeToReserves,
  convertReserveDepositToIncome,
  createFundedExpense,
  createReserve,
  createReserveDeposit,
  createReserveIncomeTransfer,
  createReserveSpending,
  createReserveTransfer,
  deleteReserve,
  deleteReserveDeposit,
  deleteReserveSpending,
  deleteReserveTransfer,
  listReserveOperations,
  listReserves,
  renameReserve,
  reserveKeys,
  updateReserveDeposit,
  updateReserveSpending,
} from "../api/reserves";
import { ReserveDepositForm } from "../components/reserves/ReserveDepositForm";
import { ReserveFundedExpenseForm } from "../components/reserves/ReserveFundedExpenseForm";
import { ReserveIncomeTransferForm } from "../components/reserves/ReserveIncomeTransferForm";
import { ReserveSpendingForm } from "../components/reserves/ReserveSpendingForm";
import { ReserveTransferForm } from "../components/reserves/ReserveTransferForm";
import { IconArrowR, IconChevR, IconPlus, IconX } from "../components/ui/Icons";
import { prettyDate } from "../lib/dates";
import { money2 } from "../lib/money";
import { invalidateAllTransactionCaches } from "../lib/monthCaches";
import type {
  FundedExpenseInput,
  Reserve,
  ReserveAllocationInput,
  ReserveDepositInput,
  ReserveIncomeTransferInput,
  ReserveOperation,
  ReserveSpendingInput,
  ReserveTransferInput,
  Transaction,
} from "../types";

type DialogState =
  | { type: "create" }
  | { type: "manage" }
  | { type: "deposit" }
  | { type: "edit-deposit"; operation: ReserveOperation }
  | { type: "spend" }
  | { type: "edit-spend"; operation: ReserveOperation }
  | { type: "move-out" }
  | { type: "income-transfer" }
  | { type: "funded-expense" }
  | { type: "transfer" }
  | null;

const OPERATION_LABEL: Record<ReserveOperation["operation_type"], string> = {
  deposit: "Sent to reserves",
  reserve_spend: "Reserve spending",
  move_to_income: "From reserve",
  funded_expense: "Funded expense",
  transfer: "Transfer",
};

function currentYear(): number {
  return new Date().getFullYear();
}

function parsedYear(value: string | null): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1 && year <= 9998 ? year : currentYear();
}

function operationSignedAmount(operation: ReserveOperation): string {
  const outflow = operation.operation_type === "reserve_spend" || operation.operation_type === "move_to_income" || operation.operation_type === "funded_expense";
  return `${outflow ? "−" : operation.operation_type === "deposit" ? "+" : ""}${money2(operation.total)}`;
}

function ReserveDialog({ title, description, effect = "house", onClose, children }: {
  title: string;
  description?: string;
  effect?: "outside" | "into-normal" | "choice" | "house";
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef(onClose);
  const dialogRef = useRef<HTMLElement | null>(null);
  const openedAt = useRef(Date.now());
  closeRef.current = onClose;
  useEffect(() => {
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const initial = dialogRef.current?.querySelector<HTMLElement>(`.reserve-dialog-body [autofocus], .reserve-dialog-body ${focusableSelector}`);
    initial?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="reserve-dialog-backdrop" onClick={(event) => { if (Date.now() - openedAt.current < 400) return; if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="reserve-dialog" role="dialog" aria-modal="true" aria-labelledby="reserve-dialog-title" aria-describedby={description ? "reserve-dialog-description" : undefined}>
        <header className="reserve-dialog-head">
          <h2 id="reserve-dialog-title">{title}</h2>
          <button type="button" className="x-btn" aria-label="Close dialog" onClick={onClose}><IconX size={17} /></button>
        </header>
        {description && <p id="reserve-dialog-description" className={`reserve-dialog-effect reserve-dialog-effect--${effect}`}>{description}</p>}
        <div className="reserve-dialog-body">{children}</div>
      </section>
    </div>
  );
}

function ReserveNameForm({ reserve, creating, submitting, onCancel, onSave }: {
  reserve?: Reserve;
  creating?: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSave: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(reserve?.name ?? "");
  const [error, setError] = useState("");
  const id = creating ? "create-reserve-name" : `reserve-name-${reserve?.id ?? "selected"}`;

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
      <label htmlFor={id}>{creating ? "Reserve name" : `New name for ${reserve?.name}`}</label>
      <input id={id} className="input" value={name} maxLength={80} autoFocus aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => setName(event.target.value)} />
      {error && <p id={`${id}-error`} role="alert" className="err-msg">{error}</p>}
      <div className="reserve-actions">
        <button type="button" className="btn btn-soft" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={submitting}>{creating ? "Save reserve" : "Save"}</button>
      </div>
    </form>
  );
}

function HistoryYearInput({ year, onCommit }: { year: number; onCommit: (year: number) => void }) {
  const [draft, setDraft] = useState(String(year));
  useEffect(() => setDraft(String(year)), [year]);
  function commit() {
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 9998) onCommit(parsed);
    else setDraft(String(year));
  }
  return <input id="reserve-history-year" className="input" type="number" min="1" max="9998" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function ReserveSidebarItem({ reserve, selected, onSelect }: { reserve: Reserve; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`reserves-workspace-item${selected ? " selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      aria-label={`${reserve.name}, ${money2(reserve.balance)}`}
      onClick={onSelect}
    >
      <span className="reserves-workspace-dot" />
      <span className="reserves-workspace-item-name">
        <strong>{reserve.name}</strong>
        {reserve.is_general && <small>General</small>}
      </span>
      <strong className="num">{money2(reserve.balance)}</strong>
    </button>
  );
}

function ActivityRow({ operation, selectedReserveId, onEdit, onConvert, onDelete }: {
  operation: ReserveOperation;
  selectedReserveId: string;
  onEdit: (operation: ReserveOperation) => void;
  onConvert: (operation: ReserveOperation) => void;
  onDelete: (operation: ReserveOperation) => void;
}) {
  const selectedEntry = operation.entries.find((entry) => entry.reserve_id === selectedReserveId);
  const transferSign = operation.operation_type === "transfer" && selectedEntry ? (selectedEntry.direction === "withdrawal" ? "−" : "+") : "";
  return (
    <article className="reserves-activity-row">
      <span className={`reserves-operation-icon ${operation.operation_type}`} aria-hidden="true">
        {operation.operation_type === "transfer" ? <IconArrowR size={15} /> : operation.operation_type === "deposit" ? <IconPlus size={15} /> : "−"}
      </span>
      <div className="reserves-activity-copy">
        <div className="reserves-activity-title">
          <strong>{operation.description}</strong>
          <span className={`reserves-operation-label ${operation.operation_type}`}>{OPERATION_LABEL[operation.operation_type]}</span>
        </div>
        <p className="muted">{prettyDate(operation.date)}{operation.note ? ` · ${operation.note}` : ""}</p>
        {operation.operation_type === "transfer" && <p className="muted">{operation.entries.map((entry) => `${entry.direction === "withdrawal" ? "From" : "To"} ${entry.reserve_name}`).join(" · ")}</p>}
        {operation.operation_type === "deposit" && operation.entries.length > 1 && <p className="muted">{operation.entries.map((entry) => `${entry.reserve_name} ${money2(entry.amount)}`).join(" · ")}</p>}
      </div>
      <strong className={`num reserves-activity-amount ${selectedEntry?.direction ?? ""}`}>{transferSign}{operation.operation_type === "transfer" ? money2(selectedEntry?.amount ?? operation.total) : operationSignedAmount(operation)}</strong>
      {(operation.editable || operation.deletable || operation.operation_type === "deposit") && (
        <details className="reserve-operation-menu">
          <summary aria-label={`Actions for ${operation.description}`}>•••</summary>
          <div className="reserve-actions">
            {operation.editable && <button type="button" className="btn btn-soft" onClick={() => onEdit(operation)}>Edit</button>}
            {operation.operation_type === "deposit" && <button type="button" className="btn btn-soft" onClick={() => onConvert(operation)}>Move to normal income</button>}
            {operation.deletable && <button type="button" className="btn btn-soft" onClick={() => onDelete(operation)}>Delete reserve operation</button>}
          </div>
        </details>
      )}
    </article>
  );
}

export function ReservesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [archivedOpen, setArchivedOpen] = useState(searchParams.get("archived") === "1");
  const triggerRef = useRef<HTMLElement | null>(null);
  const conversionTxn = (location.state as { convertIncome?: Transaction } | null)?.convertIncome;
  const year = parsedYear(searchParams.get("year"));

  const reservesQuery = useQuery({ queryKey: reserveKeys.list(false), queryFn: ({ signal }) => listReserves(false, signal), retry: false });
  const archivedQuery = useQuery({ queryKey: reserveKeys.list(true), queryFn: ({ signal }) => listReserves(true, signal), retry: false });
  const reserves = reservesQuery.data ?? [];
  const requestedReserveId = searchParams.get("reserve");
  const selectedReserve = reserves.find((reserve) => reserve.id === requestedReserveId) ?? reserves.find((reserve) => reserve.is_general) ?? reserves[0];
  const history = useQuery({
    queryKey: reserveKeys.operations(year, selectedReserve?.id),
    queryFn: ({ signal }) => listReserveOperations(year, selectedReserve?.id, signal),
    enabled: !!selectedReserve,
    retry: false,
  });

  useEffect(() => {
    if (!selectedReserve) return;
    const normalized = new URLSearchParams(searchParams);
    let changed = false;
    if (normalized.get("reserve") !== selectedReserve.id) { normalized.set("reserve", selectedReserve.id); changed = true; }
    if (normalized.get("year") !== String(year)) { normalized.set("year", String(year)); changed = true; }
    if (changed) setSearchParams(normalized, { replace: true });
  }, [searchParams, selectedReserve, setSearchParams, year]);

  function openDialog(next: Exclude<DialogState, null>) {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setDialog(next);
  }
  function closeDialog() {
    setDialog(null);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }
  function selectReserve(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set("reserve", id);
    next.set("year", String(year));
    setSearchParams(next, { replace: true });
  }
  function selectYear(nextYear: number) {
    const next = new URLSearchParams(searchParams);
    next.set("year", String(nextYear));
    if (selectedReserve) next.set("reserve", selectedReserve.id);
    setSearchParams(next, { replace: true });
  }
  async function invalidateReserveData() {
    await queryClient.invalidateQueries({ queryKey: reserveKeys.all });
  }

  const create = useMutation({ mutationFn: (name: string) => createReserve({ name }), retry: false, onSuccess: async (created) => { closeDialog(); await invalidateReserveData(); selectReserve(created.id); } });
  const rename = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => renameReserve(id, { name }), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const deposit = useMutation({ mutationFn: (input: ReserveDepositInput) => createReserveDeposit(input), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const updateDeposit = useMutation({ mutationFn: ({ id, input }: { id: string; input: ReserveDepositInput }) => updateReserveDeposit(id, input), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const convertDeposit = useMutation({ mutationFn: (id: string) => convertReserveDepositToIncome(id), retry: false, onSuccess: async () => { invalidateAllTransactionCaches(queryClient); await invalidateReserveData(); } });
  const convertIncome = useMutation({ mutationFn: (input: { id: string; allocations: ReserveAllocationInput[] }) => convertIncomeToReserves(input.id, input.allocations), retry: false, onSuccess: async () => { invalidateAllTransactionCaches(queryClient); await invalidateReserveData(); navigate("/record"); } });
  const spend = useMutation({ mutationFn: (input: ReserveSpendingInput) => createReserveSpending(input), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const updateSpend = useMutation({ mutationFn: ({ id, input }: { id: string; input: ReserveSpendingInput }) => updateReserveSpending(id, input), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const incomeTransfer = useMutation({ mutationFn: (input: ReserveIncomeTransferInput) => createReserveIncomeTransfer(input), retry: false, onSuccess: async () => { closeDialog(); invalidateAllTransactionCaches(queryClient); await invalidateReserveData(); } });
  const fundedExpense = useMutation({ mutationFn: (input: FundedExpenseInput) => createFundedExpense(input), retry: false, onSuccess: async () => { closeDialog(); invalidateAllTransactionCaches(queryClient); await invalidateReserveData(); } });
  const transfer = useMutation({ mutationFn: (input: ReserveTransferInput) => createReserveTransfer(input), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const archive = useMutation({ mutationFn: (id: string) => archiveReserve(id), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const removeReserve = useMutation({ mutationFn: (id: string) => deleteReserve(id), retry: false, onSuccess: async () => { closeDialog(); await invalidateReserveData(); } });
  const removeTransfer = useMutation({ mutationFn: (id: string) => deleteReserveTransfer(id), retry: false, onSuccess: invalidateReserveData });
  const removeSpend = useMutation({ mutationFn: (id: string) => deleteReserveSpending(id), retry: false, onSuccess: invalidateReserveData });
  const removeDeposit = useMutation({ mutationFn: (id: string) => deleteReserveDeposit(id), retry: false, onSuccess: invalidateReserveData });

  const archived = (archivedQuery.data ?? []).filter((reserve) => reserve.archived);
  const aggregate = reserves.reduce((sum, reserve) => sum + reserve.balance, 0);
  const reserveShare = selectedReserve && aggregate > 0 ? Math.round((selectedReserve.balance / aggregate) * 100) : 0;
  const operations = history.data ?? [];
  const conversionInitial = conversionTxn && selectedReserve ? {
    id: "income-conversion",
    operation_type: "deposit" as const,
    date: conversionTxn.date,
    description: conversionTxn.category,
    note: "",
    total: conversionTxn.amount,
    entries: [{ id: "conversion-allocation", reserve_id: selectedReserve.id, reserve_name: selectedReserve.name, direction: "deposit" as const, amount: conversionTxn.amount }],
    created_at: "",
    updated_at: "",
    editable: false,
    deletable: false,
  } : undefined;

  function deleteOperation(operation: ReserveOperation) {
    const effects = operation.operation_type === "funded_expense"
      ? `This removes the ${money2(operation.total)} reserve withdrawal, normal income, and cash expense.`
      : operation.operation_type === "move_to_income"
        ? `This removes the ${money2(operation.total)} reserve withdrawal and normal income.`
        : operation.operation_type === "transfer"
          ? "This removes both sides of the reserve transfer."
          : "This removes the reserve operation.";
    if (!window.confirm(`Delete reserve operation?\n\n${effects}`)) return;
    if (operation.operation_type === "transfer") removeTransfer.mutate(operation.id);
    else if (operation.operation_type === "deposit") removeDeposit.mutate(operation.id);
    else removeSpend.mutate(operation.id);
  }

  if (reservesQuery.isPending) return <div className="content"><p role="status">Loading reserves…</p></div>;
  if (reservesQuery.isError) return <div className="content" role="alert"><h1 className="page-title">Reserves</h1><p>Could not load reserves.</p><button type="button" className="btn btn-soft" onClick={() => void reservesQuery.refetch()}>Retry</button></div>;
  if (!selectedReserve) return <div className="content"><div className="page-head"><div><h1 className="page-title">Reserves</h1><p className="page-sub">Set money aside without distorting normal spending.</p></div></div><div className="card card-pad"><p>No reserves are available yet.</p><button type="button" className="btn btn-primary" onClick={() => openDialog({ type: "create" })}>Create reserve</button></div>{dialog?.type === "create" && <ReserveDialog title="Create reserve" effect="house" description="Create the first earmark. It stays outside normal income and spending until you move money in." onClose={closeDialog}><ReserveNameForm creating submitting={create.isPending} onCancel={closeDialog} onSave={create.mutateAsync} /></ReserveDialog>}</div>;

  return (
    <div className="content fade-in reserves-page">
      <div className="page-head">
        <div><h1 className="page-title">Reserves</h1><p className="page-sub">Choose a reserve to inspect its balance and complete movement history.</p></div>
        <div className="reserves-aggregate"><span className="stat-lbl">Total reserves</span><strong className="num">{money2(aggregate)}</strong></div>
      </div>

      <section className="reserves-workspace" role="region" aria-label="Reserve ledger workspace">
        <nav className="reserves-workspace-sidebar" aria-label="Reserve list">
          <div className="reserves-sidebar-heading"><strong>Active reserves</strong><span className="muted">{reserves.length}/5</span></div>
          <label className="reserves-mobile-select-label" htmlFor="mobile-reserve-select">Selected reserve</label>
          <select id="mobile-reserve-select" className="input reserves-mobile-select" value={selectedReserve.id} onChange={(event) => selectReserve(event.target.value)}>{reserves.map((reserve) => <option key={reserve.id} value={reserve.id}>{reserve.name} · {money2(reserve.balance)}</option>)}</select>
          <div className="reserves-desktop-list">{reserves.map((reserve) => <ReserveSidebarItem key={reserve.id} reserve={reserve} selected={reserve.id === selectedReserve.id} onSelect={() => selectReserve(reserve.id)} />)}</div>
          <button type="button" className="reserves-new-button" aria-label="Create reserve" disabled={reserves.length >= 5} onClick={() => openDialog({ type: "create" })}><IconPlus size={15} /> New reserve</button>
          <div className="reserves-sidebar-total"><span className="muted">Across active reserves</span><strong className="num">{money2(aggregate)}</strong></div>
          {archived.length > 0 && <div className="reserves-archived"><button type="button" aria-expanded={archivedOpen} onClick={() => { const open = !archivedOpen; setArchivedOpen(open); const next = new URLSearchParams(searchParams); if (open) next.set("archived", "1"); else next.delete("archived"); setSearchParams(next, { replace: true }); }}>Archived <span>{archived.length}</span></button>{archivedOpen && archived.map((reserve) => <div className="reserves-archived-row" key={reserve.id}><span>{reserve.name}</span><strong className="num">{money2(reserve.balance)}</strong></div>)}</div>}
        </nav>

        <section className="reserves-workspace-detail" role="region" aria-label={`${selectedReserve.name} details`}>
          <header className="reserves-detail-head">
            <div><span className="reserves-eyebrow">{selectedReserve.is_general ? "General reserve" : "Named reserve"}</span><h2>{selectedReserve.name}</h2><p className="muted">Money assigned to this reserve only.</p></div>
            <div className="reserves-detail-balance"><span className="stat-lbl">Current balance</span><strong className="num">{money2(selectedReserve.balance)}</strong></div>
          </header>
          <div className="reserves-action-bar">
            <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: "deposit" })}>Add money</button>
            <button type="button" className="btn btn-soft" onClick={() => openDialog({ type: "spend" })}>Spend</button>
            <button type="button" className="btn btn-soft" onClick={() => openDialog({ type: "move-out" })}>Move out</button>
            <button type="button" className="btn btn-soft" disabled={reserves.length < 2} onClick={() => openDialog({ type: "transfer" })}>Transfer</button>
            <button type="button" className="btn btn-soft reserves-manage-button" onClick={() => openDialog({ type: "manage" })}>Manage</button>
          </div>
          <div className="reserves-mini-stats">
            <div><span className="muted">Reserve share</span><strong className="num">{reserveShare}%</strong></div>
            <div><span className="muted">Activity</span><strong>{history.isPending ? "—" : operations.length} operations</strong></div>
            <div><label className="muted" htmlFor="reserve-history-year">Year</label><HistoryYearInput year={year} onCommit={selectYear} /></div>
          </div>
          <div className="reserves-activity">
            <div className="reserves-activity-head"><div><h3>Activity</h3><p className="muted">Every movement touching {selectedReserve.name}.</p></div></div>
            {history.isPending ? <div className="reserves-activity-skeleton" aria-label="Loading reserve activity" /> : history.isError ? <div role="alert"><p>Could not load reserve activity.</p><button type="button" className="btn btn-soft" onClick={() => void history.refetch()}>Retry activity</button></div> : operations.length === 0 ? <div className="reserves-empty-activity"><p>No activity for this reserve in {year}.</p><button type="button" className="btn btn-primary" onClick={() => openDialog({ type: "deposit" })}>Add its first deposit</button></div> : operations.map((operation) => <ActivityRow key={operation.id} operation={operation} selectedReserveId={selectedReserve.id} onEdit={(item) => openDialog(item.operation_type === "deposit" ? { type: "edit-deposit", operation: item } : { type: "edit-spend", operation: item })} onConvert={(item) => { if (window.confirm("Move this reserve deposit to normal income?")) convertDeposit.mutate(item.id); }} onDelete={deleteOperation} />)}
          </div>
        </section>
      </section>

      {conversionTxn && conversionInitial && <ReserveDialog title="Move income to reserves" effect="into-normal" description={`Allocate the full ${money2(conversionTxn.amount)}. It will stop counting as normal income.`} onClose={() => navigate("/record")}><ReserveDepositForm initial={conversionInitial} expectedTotal={conversionTxn.amount} reserves={reserves} submitting={convertIncome.isPending} onCancel={() => navigate("/record")} onSave={(input) => convertIncome.mutateAsync({ id: conversionTxn.id, allocations: input.allocations })} /></ReserveDialog>}
      {dialog?.type === "create" && <ReserveDialog title="Create reserve" effect="house" description={`${reserves.length} of 5 slots used. Creating a reserve does not move money or change normal income and spending.`} onClose={closeDialog}><ReserveNameForm creating submitting={create.isPending} onCancel={closeDialog} onSave={create.mutateAsync} /></ReserveDialog>}
      {dialog?.type === "manage" && <ReserveDialog title={`Manage ${selectedReserve.name}`} effect="house" description={selectedReserve.is_general ? "Rename only. This does not move money or change normal analytics. General Reserve cannot be archived or deleted." : "Rename or retire this earmark. That does not move money or change normal income and spending."} onClose={closeDialog}><ReserveNameForm key={selectedReserve.id} reserve={selectedReserve} submitting={rename.isPending} onCancel={closeDialog} onSave={(name) => rename.mutateAsync({ id: selectedReserve.id, name })} />{!selectedReserve.is_general && <div className="reserves-manage-danger"><button type="button" className="btn btn-soft" disabled={selectedReserve.balance !== 0 || archive.isPending} title={selectedReserve.balance !== 0 ? "Balance must be zero before archiving" : undefined} onClick={() => { if (window.confirm(`Archive ${selectedReserve.name}?`)) archive.mutate(selectedReserve.id); }}>Archive reserve</button><button type="button" className="btn btn-soft" disabled={removeReserve.isPending} onClick={() => { if (window.confirm(`Delete ${selectedReserve.name}? Only empty reserves can be deleted.`)) removeReserve.mutate(selectedReserve.id); }}>Delete reserve</button></div>}</ReserveDialog>}
      {dialog?.type === "deposit" && <ReserveDialog title="Add money to reserves" effect="outside" description="This stays outside normal income and spending calculations." onClose={closeDialog}><ReserveDepositForm key={selectedReserve.id} reserves={reserves} initialReserveId={selectedReserve.id} submitting={deposit.isPending} onCancel={closeDialog} onSave={deposit.mutateAsync} /></ReserveDialog>}
      {dialog?.type === "edit-deposit" && <ReserveDialog title="Edit reserve deposit" effect="outside" description="This stays outside normal income and spending calculations." onClose={closeDialog}><ReserveDepositForm reserves={reserves} initial={dialog.operation} submitting={updateDeposit.isPending} onCancel={closeDialog} onSave={(input) => updateDeposit.mutateAsync({ id: dialog.operation.id, input })} /></ReserveDialog>}
      {dialog?.type === "spend" && <ReserveDialog title="Record reserve spending" effect="outside" description="This changes only the reserve balance and will not appear in normal spending." onClose={closeDialog}><ReserveSpendingForm key={selectedReserve.id} reserves={reserves} initial={{ reserve_id: selectedReserve.id }} submitting={spend.isPending} onCancel={closeDialog} onSave={spend.mutateAsync} /></ReserveDialog>}
      {dialog?.type === "edit-spend" && <ReserveDialog title="Edit reserve spending" effect="outside" description="This changes only the reserve balance and will not appear in normal spending." onClose={closeDialog}><ReserveSpendingForm reserves={reserves} initial={{ reserve_id: dialog.operation.entries[0]?.reserve_id, amount: dialog.operation.total, date: dialog.operation.date, description: dialog.operation.description, note: dialog.operation.note }} submitting={updateSpend.isPending} onCancel={closeDialog} onSave={(input) => updateSpend.mutateAsync({ id: dialog.operation.id, input })} /></ReserveDialog>}
      {dialog?.type === "move-out" && <ReserveDialog title="Move money out" effect="choice" description="Choose how this should affect normal income and spending." onClose={closeDialog}><div className="reserves-operation-chooser"><button type="button" aria-label="Record reserve spending" onClick={() => setDialog({ type: "spend" })}><strong>Record reserve spending</strong><span>No normal transaction is created.</span><IconChevR size={16} /></button><button type="button" aria-label="Move to income" onClick={() => setDialog({ type: "income-transfer" })}><strong>Move to income</strong><span>Creates normal income.</span><IconChevR size={16} /></button><button type="button" aria-label="Create expense from reserve" onClick={() => setDialog({ type: "funded-expense" })}><strong>Create expense from reserve</strong><span>Creates matching normal income and a cash expense.</span><IconChevR size={16} /></button></div></ReserveDialog>}
      {dialog?.type === "income-transfer" && <ReserveDialog title="Move reserve money to income" effect="into-normal" description="This creates normal income and affects income calculations." onClose={closeDialog}><ReserveIncomeTransferForm key={selectedReserve.id} reserves={reserves} initialReserveId={selectedReserve.id} submitting={incomeTransfer.isPending} onCancel={closeDialog} onSave={incomeTransfer.mutateAsync} /></ReserveDialog>}
      {dialog?.type === "funded-expense" && <ReserveDialog title="Create cash expense from reserve" effect="into-normal" description="The generated income and expense are deleted together and cannot be edited independently." onClose={closeDialog}><ReserveFundedExpenseForm key={selectedReserve.id} reserves={reserves} initialReserveId={selectedReserve.id} submitting={fundedExpense.isPending} onCancel={closeDialog} onSave={fundedExpense.mutateAsync} /></ReserveDialog>}
      {dialog?.type === "transfer" && <ReserveDialog title="Transfer between reserves" effect="outside" description="This changes allocations without changing total reserves or normal analytics." onClose={closeDialog}><ReserveTransferForm key={selectedReserve.id} reserves={reserves} initialFromReserveId={selectedReserve.id} submitting={transfer.isPending} onCancel={closeDialog} onSave={transfer.mutateAsync} /></ReserveDialog>}
    </div>
  );
}
