import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChitInstallment, getChit } from "../api/chits";
import { IconChevL } from "../components/ui/Icons";
import { todayISO, validateInstallmentForm } from "../lib/chits";
import type { ChitInstallmentInput } from "../types";

function invalidateChit(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["chits"] });
  qc.invalidateQueries({ queryKey: ["chit", id] });
}

export function ChitInstallmentCreatePage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: chit, isLoading, isError } = useQuery({
    queryKey: ["chit", id],
    queryFn: () => getChit(id),
    enabled: Boolean(id),
  });

  const [form, setForm] = useState<ChitInstallmentInput>({
    amount: 0,
    paid_on: todayISO(),
    note: "",
  });
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    if (!chit) return;
    if (chit.expected_monthly > 0) {
      setForm((prev) => ({ ...prev, amount: prev.amount || chit.expected_monthly }));
    }
  }, [chit]);

  const completed = chit?.status === "completed";

  const create = useMutation({
    mutationFn: (body: ChitInstallmentInput) => createChitInstallment(id, body),
    onSuccess: () => {
      invalidateChit(qc, id);
      navigate(`/chits/${id}`);
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not record installment");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");
    const err = validateInstallmentForm(form);
    if (err) {
      setFormErr(err);
      return;
    }
    create.mutate(form);
  }

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
        onClick={() => navigate(`/chits/${id}`)}
      >
        <IconChevL size={15} /> Back to chit
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Add installment</h1>
          <p className="page-sub">
            {chit.name} — one row is one complete installment. Split payments are not supported.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        {completed ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            This chit is completed. Delete an installment on the chit page if you need to record another.
          </p>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inst-paid-on">Paid on</label>
                <input
                  id="inst-paid-on"
                  className="input"
                  type="date"
                  value={form.paid_on}
                  onChange={(e) => setForm({ ...form, paid_on: e.target.value })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="inst-amount">Amount paid</label>
                <input
                  id="inst-amount"
                  className="input"
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={form.amount || ""}
                  onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="field" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                <label htmlFor="inst-note">Note</label>
                <input
                  id="inst-note"
                  className="input"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            {formErr && <p className="err-msg" style={{ marginTop: 10 }}>{formErr}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "auto", padding: "10px 18px" }}
                disabled={create.isPending}
              >
                {create.isPending ? "Saving…" : "Save installment"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: "auto", padding: "10px 18px" }}
                onClick={() => navigate(`/chits/${id}`)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
