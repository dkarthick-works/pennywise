import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createChit } from "../api/chits";
import { IconChevL } from "../components/ui/Icons";
import {
  emptyChitForm,
  toChitInput,
  validateChitForm,
} from "../lib/chits";

export function ChitCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyChitForm);
  const [formErr, setFormErr] = useState("");

  const create = useMutation({
    mutationFn: createChit,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["chits"] });
      navigate(`/chits/${created.id}`);
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not create chit");
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");
    const err = validateChitForm(form);
    if (err) {
      setFormErr(err);
      return;
    }
    create.mutate(toChitInput(form));
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
          <h1 className="page-title">Add a chit</h1>
          <p className="page-sub">
            Record a scheme you subscribe to. Installments stay separate from expenses and dashboard totals.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-name">Name</label>
              <input
                id="chit-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Scheme name"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-organizer">Organizer</label>
              <input
                id="chit-organizer"
                className="input"
                value={form.organizer}
                onChange={(e) => setForm({ ...form, organizer: e.target.value })}
                placeholder="Who runs this chit"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-value">Chit value</label>
              <input
                id="chit-value"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                value={form.chit_value || ""}
                onChange={(e) => setForm({ ...form, chit_value: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-expected">Expected installment</label>
              <input
                id="chit-expected"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                value={form.expected_monthly || ""}
                onChange={(e) => setForm({ ...form, expected_monthly: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-total">Total installments</label>
              <input
                id="chit-total"
                className="input"
                type="number"
                min={1}
                max={360}
                step={1}
                value={form.total_installments || ""}
                onChange={(e) => setForm({ ...form, total_installments: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="chit-start">Start month</label>
              <input
                id="chit-start"
                className="input"
                type="month"
                value={form.start_month_ym}
                onChange={(e) => setForm({ ...form, start_month_ym: e.target.value })}
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
              {create.isPending ? "Saving…" : "Save chit"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 18px" }}
              onClick={() => navigate("/chits")}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
