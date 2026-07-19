import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSettings,
  updateBudgets,
  updatePreferences,
  updateCreditStatementDay,
  updateCreditSpendingThreshold,
  putTemplates,
} from "../api/ledger";
import { inr } from "../lib/money";
import { invalidateCreditCaches } from "../lib/monthCaches";
import { cyclePreviewSentence } from "../lib/billingCycle";
import { currentMonth } from "../lib/dates";
import { IconPlus, IconX } from "../components/ui/Icons";
import type { Budgets } from "../types";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Credit card controls groups the statement closing day and the per-period
// spending threshold. Both hydrate from the async settings query and use an
// explicit Save/Clear (never autosave).
function CreditCardControlsCard({
  savedDay,
  savedThreshold,
}: {
  savedDay: number | null;
  savedThreshold: number | null;
}) {
  return (
    <div id="credit-billing-cycle" className="card card-pad" style={{ marginBottom: 18 }}>
      <h3 className="card-h" style={{ marginBottom: 4 }}>Credit card controls</h3>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>
        Settings for how credit card spending is tracked across statement cycles and calendar months.
      </p>

      <CreditBillingCycleControl savedDay={savedDay} />

      <div style={{ height: 1, background: "var(--border-2)", margin: "18px 0" }} />

      <CreditSpendingThresholdControl savedThreshold={savedThreshold} />
    </div>
  );
}

// Credit card statement closing day. Hydrates from the async settings query,
// uses an explicit Save/Clear (never autosaves), and shows a live cycle preview.
function CreditBillingCycleControl({ savedDay }: { savedDay: number | null }) {
  const qc = useQueryClient();
  const [day, setDay] = useState<number | null>(savedDay);
  const [dirty, setDirty] = useState(false);

  // Hydrate when the saved value arrives/changes (e.g. async settings load or a
  // successful save) without clobbering an in-progress edit. This render-phase
  // reset is React's recommended alternative to a setState-in-effect.
  const [prevSaved, setPrevSaved] = useState(savedDay);
  if (savedDay !== prevSaved) {
    setPrevSaved(savedDay);
    if (!dirty) setDay(savedDay);
  }

  const mut = useMutation({
    mutationFn: (d: number | null) => updateCreditStatementDay(d),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
      invalidateCreditCaches(qc);
    },
  });

  const preview = day != null ? cyclePreviewSentence(currentMonth(), day) : null;
  const busy = mut.isPending;

  return (
    <div>
      <h4 style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 4px" }}>Statement closing day</h4>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Which day of the month is your credit card statement generated? Choose the billing or
        statement date shown in your bank app or monthly statement — not the payment due date.
      </p>

      <Row label="Statement closing day" sub="Applies to all credit transactions, by recorded transaction date">
        <select
          className="input"
          style={{ padding: "8px 12px", minWidth: 130 }}
          value={day == null ? "" : String(day)}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            setDay(v === "" ? null : Number(v));
            setDirty(true);
          }}
        >
          <option value="">Not set</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{ordinal(d)}</option>
          ))}
        </select>
      </Row>

      {day != null && day >= 29 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Shorter months use their last day (for example, the 31st becomes 28 or 29 in February).
        </p>
      )}

      {preview && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--surface-2)",
            border: "1px solid var(--border-2)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{preview}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            All recorded credit transactions within these dates will be included.
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn btn-soft"
          disabled={busy || !dirty || day == null}
          onClick={() => mut.mutate(day)}
        >
          {busy ? "Saving…" : "Save billing cycle"}
        </button>
        <button
          className="btn"
          disabled={busy || savedDay == null}
          onClick={() => { setDirty(false); setDay(null); mut.mutate(null); }}
        >
          Clear
        </button>
        {mut.isError && (
          <span style={{ fontSize: 12.5, color: "var(--danger, #c0392b)" }}>
            Couldn’t save — please try again.
          </span>
        )}
        {mut.isSuccess && !dirty && !busy && (
          <span className="muted" style={{ fontSize: 12.5 }}>Saved.</span>
        )}
      </div>
    </div>
  );
}

// Two-decimal positive amount, no exponent — matches the backend contract.
const THRESHOLD_DRAFT_RE = /^\d+(\.\d{1,2})?$/;

function thresholdToDraft(v: number | null): string {
  return v == null ? "" : String(v);
}

// Per-period credit spending threshold. Local string draft (nullable), explicit
// Save/Clear, hydrates from the async settings query without clobbering an edit,
// and writes the settings cache directly on success so the UI never flashes stale.
function CreditSpendingThresholdControl({ savedThreshold }: { savedThreshold: number | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string>(thresholdToDraft(savedThreshold));
  const [dirty, setDirty] = useState(false);
  const [lastAction, setLastAction] = useState<"save" | "clear" | null>(null);

  const [prevSaved, setPrevSaved] = useState(savedThreshold);
  if (savedThreshold !== prevSaved) {
    setPrevSaved(savedThreshold);
    if (!dirty) setDraft(thresholdToDraft(savedThreshold));
  }

  const mut = useMutation({
    mutationFn: (value: number | null) => updateCreditSpendingThreshold(value),
    onSuccess: (data) => {
      setDirty(false);
      // Direct cache write — avoids an invalidate/refetch flash of stale data.
      qc.setQueryData(["settings"], data);
    },
  });

  const trimmed = draft.trim();
  const validFormat = THRESHOLD_DRAFT_RE.test(trimmed);
  const parsed = validFormat ? Number(trimmed) : NaN;
  const validValue = validFormat && parsed > 0;
  const busy = mut.isPending;

  // Unchanged when the parsed value equals the saved value, or when both are empty/null.
  const unchanged = validValue
    ? parsed === savedThreshold
    : trimmed === "" && savedThreshold == null;
  const invalid = trimmed !== "" && !validValue;
  const canSave = validValue && !unchanged && !busy;
  const canClear = savedThreshold != null && !busy;

  function onSave() {
    if (!canSave) return;
    setLastAction("save");
    mut.mutate(parsed);
  }

  // Clear sends explicit null. The draft is intentionally NOT cleared here: if
  // the request fails the previous visible value is retained; on success the
  // settings cache update hydrates the field to empty.
  function onClear() {
    if (!canClear) return;
    setLastAction("clear");
    setDirty(false);
    mut.mutate(null);
  }

  return (
    <div id="credit-spending-threshold">
      <h4 style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 4px" }}>Credit spending threshold</h4>
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
        Show a warning when credit purchases in a period cross this amount. Applied independently to
        the statement cycle and the calendar month on your dashboard.
      </p>

      <Row label="Credit spending threshold" sub="Leave empty to disable. Whole rupees or up to two decimals.">
        <div style={{ display: "flex", alignItems: "center", gap: 2, border: `1px solid ${invalid ? "var(--danger, #c0392b)" : "var(--border)"}`, borderRadius: 9, padding: "6px 10px", background: "var(--surface-2)" }}>
          <span className="muted num">₹</span>
          <input
            className="num"
            type="text"
            inputMode="decimal"
            placeholder="0"
            aria-label="Credit spending threshold amount"
            value={draft}
            disabled={busy}
            onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
            style={{ width: 110, border: "none", background: "transparent", outline: "none", fontSize: 14.5, fontWeight: 600, textAlign: "right", color: "var(--ink)" }}
          />
        </div>
      </Row>

      {invalid && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10, color: "var(--danger, #c0392b)" }}>
          Enter a positive amount with at most two decimal places.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button
          className="btn btn-soft"
          disabled={!canSave}
          onClick={onSave}
        >
          {busy && lastAction === "save" ? "Saving…" : "Save threshold"}
        </button>
        <button
          className="btn"
          disabled={!canClear}
          onClick={onClear}
        >
          Clear
        </button>
        {mut.isError && (
          <span style={{ fontSize: 12.5, color: "var(--danger, #c0392b)" }}>
            Couldn’t save — please try again.
          </span>
        )}
        {mut.isSuccess && !dirty && !busy && (
          <span className="muted" style={{ fontSize: 12.5 }}>Saved.</span>
        )}
      </div>
    </div>
  );
}

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

      {/* credit card controls */}
      <CreditCardControlsCard
        savedDay={settings?.credit_statement_day ?? null}
        savedThreshold={settings?.credit_spending_threshold ?? null}
      />

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
