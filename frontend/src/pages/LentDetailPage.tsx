import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRepayment,
  deleteLent,
  deleteRepayment,
  getLent,
  updateLent,
  updateRepayment,
} from "../api/lents";
import { IconChevL } from "../components/ui/Icons";
import { prettyDate } from "../lib/dates";
import { inr } from "../lib/money";
import type { LentInput, LentRepayment, RepaymentInput } from "../types";

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function StatusChip({ status }: { status: "open" | "settled" }) {
  if (status === "settled") {
    return <span className="chip chip-paid">Settled</span>;
  }
  return <span className="chip chip-pending">Open</span>;
}

function invalidateLent(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["lents"] });
  qc.invalidateQueries({ queryKey: ["lent", id] });
}

export function LentDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: lent, isLoading, isError } = useQuery({
    queryKey: ["lent", id],
    queryFn: () => getLent(id),
    enabled: Boolean(id),
  });

  const [edit, setEdit] = useState<LentInput | null>(null);
  const [editErr, setEditErr] = useState("");
  const [repay, setRepay] = useState<RepaymentInput>({ amount: 0, repaid_on: todayISO(), note: "" });
  const [repayErr, setRepayErr] = useState("");
  const [editingRepId, setEditingRepId] = useState<string | null>(null);
  const [editRep, setEditRep] = useState<RepaymentInput>({ amount: 0, repaid_on: "", note: "" });
  const [editRepErr, setEditRepErr] = useState("");

  useEffect(() => {
    if (!lent) return;
    setEdit({
      counterparty: lent.counterparty,
      amount: lent.amount,
      lent_on: lent.lent_on,
      due_on: lent.due_on ?? "",
      note: lent.note,
    });
    if (lent.outstanding > 0) {
      setRepay((prev) => ({ ...prev, amount: lent.outstanding }));
    }
  }, [lent]);

  const saveLent = useMutation({
    mutationFn: (body: LentInput) => updateLent(id, body),
    onSuccess: () => {
      invalidateLent(qc, id);
      setEditErr("");
    },
    onError: (e: unknown) => {
      setEditErr(e instanceof Error ? e.message : "Could not update lent");
    },
  });

  const removeLent = useMutation({
    mutationFn: () => deleteLent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lents"] });
      navigate("/lents");
    },
    onError: (e: unknown) => {
      setEditErr(e instanceof Error ? e.message : "Could not delete lent");
    },
  });

  const addRepayment = useMutation({
    mutationFn: (body: RepaymentInput) => createRepayment(id, body),
    onSuccess: () => {
      invalidateLent(qc, id);
      setRepayErr("");
      setRepay({ amount: 0, repaid_on: todayISO(), note: "" });
    },
    onError: (e: unknown) => {
      setRepayErr(e instanceof Error ? e.message : "Could not record repayment");
    },
  });

  const saveRepayment = useMutation({
    mutationFn: ({ rid, body }: { rid: string; body: RepaymentInput }) =>
      updateRepayment(id, rid, body),
    onSuccess: () => {
      invalidateLent(qc, id);
      setEditingRepId(null);
      setEditRepErr("");
    },
    onError: (e: unknown) => {
      setEditRepErr(e instanceof Error ? e.message : "Could not update repayment");
    },
  });

  const removeRepayment = useMutation({
    mutationFn: (rid: string) => deleteRepayment(id, rid),
    onSuccess: () => {
      invalidateLent(qc, id);
      setEditingRepId(null);
    },
    onError: (e: unknown) => {
      setEditRepErr(e instanceof Error ? e.message : "Could not delete repayment");
    },
  });

  function startEditRep(r: LentRepayment) {
    setEditingRepId(r.id);
    setEditRep({ amount: r.amount, repaid_on: r.repaid_on, note: r.note });
    setEditRepErr("");
  }

  if (isLoading) {
    return (
      <div className="content fade-in">
        <p className="muted">Loading lent…</p>
      </div>
    );
  }

  if (isError || !lent || !edit) {
    return (
      <div className="content fade-in">
        <button
          className="btn btn-soft"
          style={{ padding: "6px 12px", marginBottom: 16 }}
          onClick={() => navigate("/lents")}
        >
          <IconChevL size={15} /> Lent
        </button>
        <p style={{ color: "var(--neg)", fontSize: 13 }}>Could not load this lent.</p>
      </div>
    );
  }

  const repayments = lent.repayments ?? [];
  const canRepay = lent.outstanding > 0;

  return (
    <div className="content fade-in">
      <button
        className="btn btn-soft"
        style={{ padding: "6px 12px", marginBottom: 16 }}
        onClick={() => navigate("/lents")}
      >
        <IconChevL size={15} /> Lent
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">{lent.counterparty}</h1>
          <p className="page-sub" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <StatusChip status={lent.status} />
            <span>Lent {prettyDate(lent.lent_on)}</span>
            {lent.due_on && <span>· Due {prettyDate(lent.due_on)}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="card card-pad" style={{ minWidth: 140, padding: "12px 16px", textAlign: "right" }}>
            <div className="stat-lbl" style={{ marginBottom: 4 }}>Principal</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{inr(lent.amount)}</div>
          </div>
          <div className="card card-pad" style={{ minWidth: 140, padding: "12px 16px", textAlign: "right" }}>
            <div className="stat-lbl" style={{ marginBottom: 4 }}>Repaid</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{inr(lent.repaid_total)}</div>
          </div>
          <div className="card card-pad" style={{ minWidth: 140, padding: "12px 16px", textAlign: "right" }}>
            <div className="stat-lbl" style={{ marginBottom: 4 }}>Outstanding</div>
            <div className="num" style={{ fontSize: 20, fontWeight: 800 }}>{inr(lent.outstanding)}</div>
          </div>
        </div>
      </div>

      {lent.note && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 18, fontSize: 13.5 }}>
          {lent.note}
        </p>
      )}

      {/* Edit lent */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Edit lent</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setEditErr("");
            saveLent.mutate({
              counterparty: edit.counterparty.trim(),
              amount: edit.amount,
              lent_on: edit.lent_on,
              due_on: edit.due_on || "",
              note: edit.note,
            });
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-counterparty">Counterparty</label>
              <input
                id="edit-counterparty"
                className="input"
                value={edit.counterparty}
                onChange={(e) => setEdit({ ...edit, counterparty: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-amount">Amount</label>
              <input
                id="edit-amount"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                value={edit.amount || ""}
                onChange={(e) => setEdit({ ...edit, amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-lent-on">Lent on</label>
              <input
                id="edit-lent-on"
                className="input"
                type="date"
                value={edit.lent_on}
                onChange={(e) => setEdit({ ...edit, lent_on: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-due">Due on (optional)</label>
              <input
                id="edit-due"
                className="input"
                type="date"
                value={edit.due_on ?? ""}
                onChange={(e) => setEdit({ ...edit, due_on: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label htmlFor="edit-note">Note</label>
              <input
                id="edit-note"
                className="input"
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              />
            </div>
          </div>
          {editErr && <p className="err-msg" style={{ marginTop: 10 }}>{editErr}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "auto", padding: "10px 18px" }}
              disabled={saveLent.isPending}
            >
              {saveLent.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn-soft"
              style={{ color: "var(--neg)" }}
              disabled={removeLent.isPending}
              onClick={() => {
                if (window.confirm(`Delete lent to ${lent.counterparty}? This also deletes all repayments.`)) {
                  removeLent.mutate();
                }
              }}
            >
              Delete lent
            </button>
          </div>
        </form>
      </div>

      {/* Repayments */}
      <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-2)", fontWeight: 700, fontSize: 14 }}>
          Repayments
        </div>
        {repayments.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>No repayments yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {repayments.map((r) => {
                const editCap = lent.outstanding + r.amount;
                if (editingRepId === r.id) {
                  return (
                    <tr key={r.id}>
                      <td colSpan={4} style={{ padding: 14 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Amount</label>
                            <input
                              className="input"
                              type="number"
                              min={0.01}
                              step="0.01"
                              max={editCap}
                              value={editRep.amount || ""}
                              onChange={(e) =>
                                setEditRep({ ...editRep, amount: parseFloat(e.target.value) || 0 })
                              }
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Repaid on</label>
                            <input
                              className="input"
                              type="date"
                              value={editRep.repaid_on}
                              onChange={(e) => setEditRep({ ...editRep, repaid_on: e.target.value })}
                            />
                          </div>
                          <div className="field" style={{ marginBottom: 0 }}>
                            <label>Note</label>
                            <input
                              className="input"
                              value={editRep.note}
                              onChange={(e) => setEditRep({ ...editRep, note: e.target.value })}
                            />
                          </div>
                        </div>
                        {editRepErr && <p className="err-msg" style={{ marginTop: 8 }}>{editRepErr}</p>}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ width: "auto", padding: "8px 14px" }}
                            disabled={saveRepayment.isPending}
                            onClick={() =>
                              saveRepayment.mutate({
                                rid: r.id,
                                body: {
                                  amount: editRep.amount,
                                  repaid_on: editRep.repaid_on,
                                  note: editRep.note,
                                },
                              })
                            }
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="btn btn-soft"
                            onClick={() => {
                              setEditingRepId(null);
                              setEditRepErr("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-soft"
                            style={{ color: "var(--neg)", marginLeft: "auto" }}
                            disabled={removeRepayment.isPending}
                            onClick={() => {
                              if (window.confirm("Delete this repayment?")) {
                                removeRepayment.mutate(r.id);
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.id}>
                    <td>{prettyDate(r.repaid_on)}</td>
                    <td className="num" style={{ textAlign: "right" }}>{inr(r.amount)}</td>
                    <td className="muted">{r.note || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-soft"
                        style={{ padding: "5px 10px", fontSize: 12 }}
                        onClick={() => startEditRep(r)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Record repayment — hidden when settled */}
      {canRepay && (
        <div className="card card-pad">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Record repayment</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRepayErr("");
              addRepayment.mutate({
                amount: repay.amount,
                repaid_on: repay.repaid_on,
                note: repay.note,
              });
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="repay-amount">Amount</label>
                <input
                  id="repay-amount"
                  className="input"
                  type="number"
                  min={0.01}
                  step="0.01"
                  max={lent.outstanding}
                  value={repay.amount || ""}
                  onChange={(e) => setRepay({ ...repay, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="repay-on">Repaid on</label>
                <input
                  id="repay-on"
                  className="input"
                  type="date"
                  value={repay.repaid_on}
                  onChange={(e) => setRepay({ ...repay, repaid_on: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="repay-note">Note</label>
                <input
                  id="repay-note"
                  className="input"
                  value={repay.note}
                  onChange={(e) => setRepay({ ...repay, note: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            {repayErr && <p className="err-msg" style={{ marginTop: 10 }}>{repayErr}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "auto", marginTop: 14, padding: "10px 18px" }}
              disabled={addRepayment.isPending}
            >
              {addRepayment.isPending ? "Saving…" : "Save repayment"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
