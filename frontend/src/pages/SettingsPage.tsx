import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateBudgets, updatePreferences, putTemplates } from "../api/ledger";
import { inr } from "../lib/money";
import { IconPlus, IconX } from "../components/ui/Icons";
import type { Budgets } from "../types";

function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, padding: "15px 0", borderBottom: "1px solid var(--border-2)", flexWrap: "wrap" }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        {sub && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{sub}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function BudgetInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid var(--border)", borderRadius: 9, padding: "6px 10px", background: "var(--surface-2)" }}>
      <span className="muted num">₹</span>
      <input
        className="num"
        value={(value || 0).toLocaleString("en-IN")}
        onChange={(e) => { const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10); onChange(isNaN(n) ? 0 : n); }}
        style={{ width: 90, border: "none", background: "transparent", outline: "none", fontSize: 14.5, fontWeight: 600, textAlign: "right", color: "var(--ink)" }}
      />
    </div>
  );
}

function TemplateEditor({ title, hint, list, onChange, color }: {
  title: string; hint: string; list: string[]; onChange: (l: string[]) => void; color: string;
}) {
  const [val, setVal] = useState("");
  function add() {
    const v = val.trim();
    if (!v) return;
    onChange([...list, v]);
    setVal("");
  }
  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <h3 className="card-h" style={{ marginBottom: 2 }}>
        <span className="dot" style={{ background: color }} />{title}
      </h3>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 14px" }}>{hint}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {list.map((c, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 100, padding: "5px 7px 5px 13px", fontSize: 13, fontWeight: 500 }}>
            {c}
            <button className="x-btn" style={{ width: 20, height: 20 }} onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <IconX size={13} />
            </button>
          </span>
        ))}
        {list.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No template rows.</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          style={{ maxWidth: 240, padding: "8px 12px" }}
          value={val}
          placeholder="Add a row…"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-soft" onClick={add}><IconPlus size={15} /> Add</button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const [localBudgets, setLocalBudgets] = useState<Budgets | null>(null);
  const budgets = localBudgets ?? settings?.budgets ?? { essential: 0, flexible: 0, daily: 0 };

  const [currency, setCurrency] = useState(settings?.currency ?? "INR");
  const [theme, setTheme]       = useState(settings?.theme ?? "light");

  // local template state until saved
  const [localEss, setLocalEss] = useState<string[] | null>(null);
  const [localFlex, setLocalFlex] = useState<string[] | null>(null);
  const essTemplates  = localEss  ?? settings?.templates.essential  ?? [];
  const flexTemplates = localFlex ?? settings?.templates.flexible   ?? [];

  const budgetMut = useMutation({
    mutationFn: updateBudgets,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const prefMut = useMutation({
    mutationFn: (b: { currency: string; theme: string }) =>
      updatePreferences({ currency: b.currency, theme: b.theme }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const essTplMut = useMutation({
    mutationFn: (labels: string[]) => putTemplates("essential", labels),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const flexTplMut = useMutation({
    mutationFn: (labels: string[]) => putTemplates("flexible", labels),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  function onBudget(k: keyof Budgets, v: number) {
    const nb = { ...budgets, [k]: v };
    setLocalBudgets(nb);
    budgetMut.mutate(nb);
  }

  function onPref(field: "currency" | "theme", v: string) {
    if (field === "currency") setCurrency(v);
    else setTheme(v);
    prefMut.mutate({
      currency: field === "currency" ? v : currency,
      theme:    field === "theme"    ? v : theme,
    });
  }

  const total = budgets.essential + budgets.flexible + budgets.daily;

  return (
    <div className="content fade-in" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Budgets, templates and preferences.</p>
        </div>
      </div>

      {/* budgets */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h3 className="card-h" style={{ marginBottom: 4 }}>Section budgets</h3>
        <Row label="Essential — Bare Minimum" sub="Rent, EMIs, savings">
          <BudgetInput value={budgets.essential} onChange={(v) => onBudget("essential", v)} />
        </Row>
        <Row label="Flexible — Subscriptions" sub="Recurring services">
          <BudgetInput value={budgets.flexible} onChange={(v) => onBudget("flexible", v)} />
        </Row>
        <Row label="Daily — Running" sub="Everyday spend">
          <BudgetInput value={budgets.daily} onChange={(v) => onBudget("daily", v)} />
        </Row>
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 14, fontSize: 13.5 }}>
          <span style={{ fontWeight: 600 }}>Total monthly budget</span>
          <span className="num" style={{ fontWeight: 700 }}>{inr(total)}</span>
        </div>
      </div>

      {/* preferences */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h3 className="card-h" style={{ marginBottom: 4 }}>Preferences</h3>
        <Row label="Currency" sub="Used across the app">
          <div className="seg">
            {["INR", "USD", "EUR"].map((c) => (
              <button key={c} className={currency === c ? "on" : ""} onClick={() => onPref("currency", c)}>{c}</button>
            ))}
          </div>
        </Row>
        <Row label="Theme" sub="Appearance">
          <div className="seg">
            {["light", "warm", "system"].map((t) => (
              <button key={t} className={theme === t ? "on" : ""} onClick={() => onPref("theme", t)} style={{ textTransform: "capitalize" }}>{t}</button>
            ))}
          </div>
        </Row>
      </div>

      {/* templates */}
      <TemplateEditor
        title="Essential template rows"
        hint="Auto-cloned into every new month with blank amounts."
        list={essTemplates}
        onChange={(l) => { setLocalEss(l); essTplMut.mutate(l); }}
        color="var(--c-essential)"
      />
      <TemplateEditor
        title="Subscription template rows"
        hint="Cloned each month — mark Cash/Credit as you go."
        list={flexTemplates}
        onChange={(l) => { setLocalFlex(l); flexTplMut.mutate(l); }}
        color="var(--c-flexible)"
      />
    </div>
  );
}
