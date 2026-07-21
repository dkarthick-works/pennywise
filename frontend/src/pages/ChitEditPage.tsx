import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteChit, getChit, updateChit } from "../api/chits";
import { IconChevL } from "../components/ui/Icons";
import {
  startMonthToMonth,
  toChitInput,
  validateChitForm,
} from "../lib/chits";

function invalidateChit(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["chits"] });
  qc.invalidateQueries({ queryKey: ["chit", id] });
}

export function ChitEditPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: chit, isLoading, isError } = useQuery({
    queryKey: ["chit", id],
    queryFn: () => getChit(id),
    enabled: Boolean(id),
  });

  const [form, setForm] = useState({
    name: "",
    organizer: "",
    chit_value: 0,
    expected_monthly: 0,
    total_installments: 0,
    start_month_ym: "",
  });
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    if (!chit) return;
    setForm({
      name: chit.name,
      organizer: chit.organizer,
      chit_value: chit.chit_value,
      expected_monthly: chit.expected_monthly,
      total_installments: chit.total_installments,
      start_month_ym: startMonthToMonth(chit.start_month),
    });
  }, [chit]);

  const metaLocked = (chit?.installment_count ?? 0) > 0;

  const save = useMutation({
    mutationFn: () => updateChit(id, toChitInput(form)),
    onSuccess: () => {
      invalidateChit(qc, id);
      navigate(`/chits/${id}`);
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not update chit");
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteChit(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chits"] });
      navigate("/chits");
    },
    onError: (e: unknown) => {
      setFormErr(e instanceof Error ? e.message : "Could not delete chit");
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
    save.mutate();
  }

  function confirmDelete() {
    if (!chit) return;
    const count = chit.installment_count;
    const ok = window.confirm(
      count === 0
        ? `Delete “${chit.name}”? This cannot be undone.`
        : `Delete “${chit.name}”? This permanently removes all ${count} recorded installment${count === 1 ? "" : "s"}. This cannot be undone.`,
    );
    if (ok) remove.mutate();
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
          <h1 className="page-title">Edit chit</h1>
          <p className="page-sub">{chit.name}</p>
        </div>
      </div>

      <div className="card card-pad">
        {metaLocked && (
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
            Start month, expected installment, and total installments are locked after the first installment.
          </p>
        )}
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-name">Name</label>
              <input
                id="edit-chit-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-organizer">Organizer</label>
              <input
                id="edit-chit-organizer"
                className="input"
                value={form.organizer}
                onChange={(e) => setForm({ ...form, organizer: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-value">Chit value</label>
              <input
                id="edit-chit-value"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                value={form.chit_value || ""}
                onChange={(e) => setForm({ ...form, chit_value: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-expected">Expected installment</label>
              <input
                id="edit-chit-expected"
                className="input"
                type="number"
                min={0.01}
                step="0.01"
                disabled={metaLocked}
                value={form.expected_monthly || ""}
                onChange={(e) => setForm({ ...form, expected_monthly: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-total">Total installments</label>
              <input
                id="edit-chit-total"
                className="input"
                type="number"
                min={1}
                max={360}
                disabled={metaLocked}
                value={form.total_installments || ""}
                onChange={(e) => setForm({ ...form, total_installments: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="edit-chit-start">Start month</label>
              <input
                id="edit-chit-start"
                className="input"
                type="month"
                disabled={metaLocked}
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
              disabled={save.isPending}
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 18px" }}
              onClick={() => navigate(`/chits/${id}`)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "auto", padding: "10px 18px", color: "var(--neg)" }}
              onClick={confirmDelete}
              disabled={remove.isPending}
            >
              Delete chit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
