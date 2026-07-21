import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteChitInstallment,
  getChit,
  updateChitInstallment,
} from "../api/chits";
import { IconChevL, IconPlus } from "../components/ui/Icons";
import {
  paymentVariance,
  startMonthToMonth,
  validateInstallmentForm,
} from "../lib/chits";
import { prettyDate } from "../lib/dates";
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
          className="btn btn-soft"
          style={{ padding: "6px 12px", marginBottom: 16 }}
          onClick={() => navigate("/chits")}
        >
          <IconChevL size={15} /> All chits
        </button>
        <p style={{ color: "var(--neg)", fontSize: 13, marginTop: 16 }}>Could not load this chit.</p>
      </div>
    );
  }

  return (
    <div className="content fade-in">
      <button
        type="button"
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate("/chits")}
      >
        <IconChevL size={15} /> All chits
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{chit.name}</h1>
          <p className="page-sub">
            Installments are tracked separately and do not affect expenses, dashboard totals, insights, or CSV exports.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatusChip status={chit.status} />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "auto", padding: "10px 14px" }}
            onClick={() => navigate(`/chits/${id}/edit`)}
          >
            Edit chit
          </button>
          {!completed && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "auto", padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
              onClick={() => navigate(`/chits/${id}/installments/new`)}
              aria-label="Add installment"
            >
              <IconPlus size={16} /> Add installment
            </button>
          )}
        </div>
      </div>

      <div
        className="card card-pad"
        style={{
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
        }}
      >
        <div>
          <div className="stat-lbl">Chit value</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{inr(chit.chit_value)}</div>
        </div>
        <div>
          <div className="stat-lbl">Expected installment</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{inr(chit.expected_monthly)}</div>
        </div>
        <div>
          <div className="stat-lbl">Total personally paid</div>
          <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{inr(chit.total_paid)}</div>
        </div>
        <div>
          <div className="stat-lbl">Progress</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {chit.installment_count} / {chit.total_installments}
          </div>
        </div>
        <div>
          <div className="stat-lbl">Organizer</div>
          <div style={{ fontWeight: 600 }}>{chit.organizer}</div>
        </div>
        <div>
          <div className="stat-lbl">Start month</div>
          <div style={{ fontWeight: 600 }}>{startMonthToMonth(chit.start_month)}</div>
        </div>
      </div>

      {completed && (
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          This chit is completed. Remove an installment below if you need to record another.
        </p>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ fontWeight: 700, fontSize: 14, padding: "14px 18px 0" }}>Installments</div>
        {(chit.installments?.length ?? 0) === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No installments recorded yet.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Paid on</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th style={{ textAlign: "right" }}>Payment variance</th>
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
                      <td className="muted" style={{ textAlign: "right" }}>—</td>
                      <td>
                        <input
                          className="input"
                          value={editInst.note}
                          onChange={(e) => setEditInst({ ...editInst, note: e.target.value })}
                        />
                        {editInstErr && <p className="err-msg">{editInstErr}</p>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ width: "auto", padding: "6px 10px", marginRight: 6 }}
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
                          style={{ width: "auto", padding: "6px 10px" }}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{prettyDate(row.paid_on)}</td>
                      <td className="num" style={{ textAlign: "right" }}>{inr(row.amount)}</td>
                      <td className="num" style={{ textAlign: "right" }}>
                        {inr(paymentVariance(chit.expected_monthly, row.amount))}
                      </td>
                      <td className="muted">{row.note || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ width: "auto", padding: "6px 10px", marginRight: 6 }}
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
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ width: "auto", padding: "6px 10px", color: "var(--neg)" }}
                          onClick={() => {
                            if (window.confirm("Remove this installment?")) {
                              removeInst.mutate(row.id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
