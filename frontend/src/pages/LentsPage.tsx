import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createLent, listLents } from "../api/lents";
import { prettyDate } from "../lib/dates";
import { inr } from "../lib/money";
import type { LentInput, LentListStatus } from "../types";

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function emptyForm(): LentInput {
  return { counterparty: "", amount: 0, lent_on: todayISO(), due_on: "", note: "" };
}

function StatusChip({ status }: { status: "open" | "settled" }) {
  if (status === "settled") {
    return <span className="chip chip-paid">Settled</span>;
  }
  return <span className="chip chip-pending">Open</span>;
}

export function LentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<LentListStatus>("open");
  const [form, setForm] = useState<LentInput>(emptyForm);
  const [formErr, setFormErr] = useState("");

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["lents", status],
    queryFn: () => listLents(status),
  });

  const { data: openLents = [] } = useQuery({
    queryKey: ["lents", "open"],
    queryFn: () => listLents("open"),
  });

  const outstandingTotal = openLents.reduce((s, l) => s + l.outstanding, 0);

  const create = useMutation({
    mutationFn: createLent,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lents"] });
      setForm(emptyForm());
      setFormErr("");
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not create lent");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");
    const counterparty = form.counterparty.trim();
    if (!counterparty) {
      setFormErr("counterparty is required");
      return;
    }
    if (!(form.amount > 0)) {
      setFormErr("amount must be greater than zero");
      return;
    }
    create.mutate({
      counterparty,
      amount: form.amount,
      lent_on: form.lent_on,
      due_on: form.due_on || "",
      note: form.note,
    });
  }

  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Lent</h1>
          <p className="page-sub">Money you lent to others — tracked separately from your budget.</p>
        </div>
        <div
          className="card card-pad"
          style={{ minWidth: 220, padding: "14px 18px", textAlign: "right" }}
        >
          <div className="stat-lbl" style={{ marginBottom: 4 }}>Outstanding</div>
          <div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {inr(outstandingTotal)}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="seg">
          {(["open", "settled", "all"] as LentListStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              className={status === s ? "on" : ""}
              onClick={() => setStatus(s)}
            >
              {s === "all" ? "All" : s === "open" ? "Open" : "Settled"}
            </button>
          ))}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Record a lent</div>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="lent-counterparty">Counterparty</label>
              <input
                id="lent-counterparty"
                className="input"
                value={form.counterparty}
                onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                placeholder="Who you lent to"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="lent-amount">Amount</label>
              <input
                id="lent-amount"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                value={form.amount || ""}
                onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="lent-on">Lent on</label>
              <input
                id="lent-on"
                className="input"
                type="date"
                value={form.lent_on}
                onChange={(e) => setForm({ ...form, lent_on: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="lent-due">Due on (optional)</label>
              <input
                id="lent-due"
                className="input"
                type="date"
                value={form.due_on ?? ""}
                onChange={(e) => setForm({ ...form, due_on: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
              <label htmlFor="lent-note">Note</label>
              <input
                id="lent-note"
                className="input"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Optional note"
              />
            </div>
          </div>
          {formErr && <p className="err-msg" style={{ marginTop: 10 }}>{formErr}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "auto", marginTop: 14, padding: "10px 18px" }}
            disabled={create.isPending}
          >
            {create.isPending ? "Saving…" : "Save lent"}
          </button>
        </form>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {isLoading ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading lents…</p>
        ) : isError ? (
          <p style={{ margin: 0, padding: 18, color: "var(--neg)", fontSize: 13 }}>
            Could not load lents.
          </p>
        ) : data.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            {status === "open"
              ? "No open lents."
              : status === "settled"
                ? "No settled lents."
                : "No lents yet."}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Counterparty</th>
                <th style={{ textAlign: "right" }}>Lent</th>
                <th style={{ textAlign: "right" }}>Outstanding</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr
                  key={l.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/lents/${l.id}`)}
                >
                  <td style={{ fontWeight: 600 }}>{l.counterparty}</td>
                  <td className="num" style={{ textAlign: "right" }}>{inr(l.amount)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{inr(l.outstanding)}</td>
                  <td className="muted">{l.due_on ? prettyDate(l.due_on) : "—"}</td>
                  <td><StatusChip status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
