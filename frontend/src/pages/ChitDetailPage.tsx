import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteChitInstallment,
  exportChits,
  getChit,
  updateChitInstallment,
} from "../api/chits";
import { IconChevL, IconExport, IconPencil, IconPlus, IconTrash } from "../components/ui/Icons";
import {
  paymentVariance,
  startMonthToMonth,
  validateInstallmentForm,
} from "../lib/chits";
import { prettyDate } from "../lib/dates";
import { downloadBlob } from "../lib/export";
import { inr } from "../lib/money";
import type { ChitInstallmentInput, ChitStatus } from "../types";

function StatusChip({ status }: { status: ChitStatus }) {
  if (status === "completed") {
    return <span className="chip chip-paid">Completed</span>;
  }
  return <span className="chip chip-pending">Active</span>;
}

function invalidateChit(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["chits"] });
  qc.invalidateQueries({ queryKey: ["chit", id] });
}

export function ChitDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: chit, isLoading, isError } = useQuery({
    queryKey: ["chit", id],
    queryFn: () => getChit(id),
    enabled: Boolean(id),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInst, setEditInst] = useState<ChitInstallmentInput>({
    amount: 0,
    paid_on: "",
    note: "",
  });
  const [editInstErr, setEditInstErr] = useState("");

  const completed = chit?.status === "completed";

  const saveInst = useMutation({
    mutationFn: ({ iid, body }: { iid: string; body: ChitInstallmentInput }) =>
      updateChitInstallment(id, iid, body),
    onSuccess: () => {
      invalidateChit(qc, id);
      setEditingId(null);
      setEditInstErr("");
    },
    onError: (e: unknown) => {
      setEditInstErr(e instanceof Error ? e.message : "Could not update installment");
    },
  });

  const removeInst = useMutation({
    mutationFn: (iid: string) => deleteChitInstallment(id, iid),
    onSuccess: () => {
      invalidateChit(qc, id);
      setEditingId(null);
    },
    onError: (e: unknown) => {
      setEditInstErr(e instanceof Error ? e.message : "Could not delete installment");
    },
  });

  const exportChitMut = useMutation({
    mutationFn: () => exportChits(id),
    retry: false,
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename);
    },
  });

  if (isLoading) {
    return (
      <div className="content fade-in">
        <p className="muted" style={{ fontSize: 13 }}>Loading chit…</p>
      </div>
    );
  }

  if (isError || !chit) {
    return (
      <div className="content fade-in">
        <button
          type="button"
          className="btn btn-soft chit-back"
          onClick={() => navigate("/chits")}
        >
          <IconChevL size={15} /> All chits
        </button>
        <p className="err-msg" style={{ marginTop: 16 }}>Could not load this chit.</p>
      </div>
    );
  }

  const progressPct = chit.total_installments > 0
    ? Math.min(100, Math.round((chit.installment_count / chit.total_installments) * 100))
    : 0;

  return (
    <div className="content fade-in">
      <button
        type="button"
        className="btn btn-soft chit-back"
        onClick={() => navigate("/chits")}
      >
        <IconChevL size={15} /> All chits
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{chit.name}</h1>
          <p className="page-sub">
            Installments are tracked separately and do not affect expenses, dashboard totals, insights, or transaction CSV exports.
          </p>
        </div>
        <StatusChip status={chit.status} />
      </div>
      <div className="chit-actions">
        {!completed && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate(`/chits/${id}/installments/new`)}
            aria-label="Add installment"
          >
            <IconPlus size={16} /> Add installment
          </button>
        )}
        <button
          type="button"
          className="btn btn-soft"
          onClick={() => exportChitMut.mutate()}
          disabled={exportChitMut.isPending}
        >
          <IconExport size={15} /> {exportChitMut.isPending ? "Exporting..." : "Export JSON"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate(`/chits/${id}/edit`)}
        >
          Edit chit
        </button>
      </div>
      {exportChitMut.isError && (
        <p className="err-msg" style={{ marginTop: -8, marginBottom: 14 }}>
          {exportChitMut.error instanceof Error ? exportChitMut.error.message : "Could not export this chit."}
        </p>
      )}

      <div className="card card-pad chit-stats">
        <div className="chit-stat">
          <div className="stat-lbl">Chit value</div>
          <div className="num">{inr(chit.chit_value)}</div>
        </div>
        <div className="chit-stat">
          <div className="stat-lbl">Expected installment</div>
          <div className="num">{inr(chit.expected_monthly)}</div>
        </div>
        <div className="chit-stat">
          <div className="stat-lbl">Total personally paid</div>
          <div className="num">{inr(chit.total_paid)}</div>
        </div>
        <div className="chit-stat">
          <div className="stat-lbl">Progress</div>
          <div className="num">{chit.installment_count} <small>/ {chit.total_installments}</small></div>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Installments paid"><i style={{ width: `${progressPct}%`, background: completed ? "var(--pos)" : "var(--accent)" }} /></div>
        </div>
        <div className="chit-stats-meta">
          <div>Organizer<strong>{chit.organizer}</strong></div>
          <div>Start month<strong>{startMonthToMonth(chit.start_month)}</strong></div>
        </div>
      </div>

      {completed && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          This chit is completed. Remove an installment below if you need to record another.
        </p>
      )}

      <div className="card chit-inst-card">
        <div className="chit-inst-head">Installments</div>
        {(chit.installments?.length ?? 0) === 0 ? (
          <p className="muted chit-inst-empty">
            No installments recorded yet.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="tbl installment-table">
            <thead>
              <tr>
                <th>Paid on</th>
                <th>Amount</th>
                <th>Payment variance</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {chit.installments.map((row) => (
                <tr key={row.id}>
                  {editingId === row.id ? (
                    <>
                      <td>
                        <input
                          className="input"
                          type="date"
                          value={editInst.paid_on}
                          onChange={(e) => setEditInst({ ...editInst, paid_on: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input"
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={editInst.amount || ""}
                          onChange={(e) => setEditInst({ ...editInst, amount: parseFloat(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="muted">—</td>
                      <td>
                        <input
                          className="input"
                          value={editInst.note}
                          onChange={(e) => setEditInst({ ...editInst, note: e.target.value })}
                        />
                        {editInstErr && <p className="err-msg">{editInstErr}</p>}
                      </td>
                      <td className="inst-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => {
                            const err = validateInstallmentForm(editInst);
                            if (err) {
                              setEditInstErr(err);
                              return;
                            }
                            saveInst.mutate({ iid: row.id, body: editInst });
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{prettyDate(row.paid_on)}</td>
                      <td className="num">{inr(row.amount)}</td>
                      <td className="num">
                        {inr(paymentVariance(chit.expected_monthly, row.amount))}
                      </td>
                      <td className="muted">{row.note || "—"}</td>
                      <td className="inst-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label="Edit installment"
                          title="Edit installment"
                          onClick={() => {
                            setEditingId(row.id);
                            setEditInst({
                              paid_on: row.paid_on,
                              amount: row.amount,
                              note: row.note,
                            });
                            setEditInstErr("");
                          }}
                        >
                          <IconPencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost inst-del"
                          aria-label="Remove installment"
                          title="Remove installment"
                          onClick={() => {
                            if (window.confirm("Remove this installment?")) {
                              removeInst.mutate(row.id);
                            }
                          }}
                        >
                          <IconTrash size={16} />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
