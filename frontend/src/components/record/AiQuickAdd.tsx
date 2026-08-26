import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createTxn, parseTransactions } from "../../api/ledger";
import { currentDate } from "../../lib/dates";
import {
  KIND_LABEL,
  SECTION_LABEL,
  nextPreviewKind,
  nextPreviewSection,
} from "../../lib/recordLabels";
import {
  clearFieldIssues,
  fieldIssues,
  otherIssues,
  previewReadiness,
  toPreviewRow,
  type PreviewRow,
} from "../../lib/transactionPreview";
import type { Section, Transaction, TxnKind } from "../../types";
import { AmountInput, CategoryInput, DateCell } from "./TableCells";
import { IconSparkles } from "../ui/Icons";

const NAME_PLACEHOLDER: Record<Section, string> = {
  essential: "e.g. Rent",
  flexible: "e.g. Netflix",
  daily: "e.g. Groceries",
  income: "e.g. Salary, Freelance",
};

function issuesText(issues: ReturnType<typeof fieldIssues>): string {
  return issues.map((issue) => issue.message).join(" · ");
}

function FieldHint({ text }: { text: string }) {
  if (!text) return null;
  return <div className="import-field-err">{text}</div>;
}

export function AiQuickAdd({
  month,
  onCreated,
}: {
  month: string;
  onCreated: (created: Transaction) => void;
}) {
  const headingId = useId();
  const statusId = useId();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseErr, setParseErr] = useState("");
  const [status, setStatus] = useState("");
  const [parsing, setParsing] = useState(false);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [saveAllPending, setSaveAllPending] = useState(false);
  const [stacked, setStacked] = useState(false);
  const previewSeq = useRef(0);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 860px)");
    const apply = () => setStacked(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const anySaving = savingIds.size > 0 || saveAllPending;
  const busy = parsing || anySaving;

  function updateRow(clientId: string, patch: Partial<PreviewRow>, clearField?: string) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.clientId !== clientId) return row;
        const next = { ...row, ...patch, saveError: "" };
        if (clearField) next.issues = clearFieldIssues(next.issues, clearField);
        return next;
      })
    );
  }

  async function generate() {
    if (parsing) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setParseErr("Describe at least one transaction");
      return;
    }
    setParsing(true);
    setParseErr("");
    setStatus("Generating previews…");
    try {
      const response = await parseTransactions({
        text: trimmed,
        reference_date: currentDate(),
      });
      setRows(
        (response.transactions ?? []).map((preview) => {
          previewSeq.current += 1;
          return toPreviewRow(preview, `preview-${previewSeq.current}`);
        })
      );
      const count = response.transactions?.length ?? 0;
      setStatus(`${count} preview${count === 1 ? "" : "s"} ready to review`);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : "Could not generate previews");
      setStatus("");
    } finally {
      setParsing(false);
    }
  }

  async function saveRow(row: PreviewRow): Promise<boolean> {
    const { ready } = previewReadiness(row, month);
    if (!ready || inFlight.current.has(row.clientId)) return false;

    const kind: TxnKind = row.section === "income" ? "cash" : (row.kind as TxnKind);
    const body: Omit<Transaction, "id" | "settled"> = {
      section: row.section as Section,
      category: row.category.trim(),
      amount: row.amount as number,
      date: row.date,
      kind,
    };

    inFlight.current.add(row.clientId);
    setSavingIds((prev) => new Set([...prev, row.clientId]));
    try {
      const created = await createTxn(body);
      onCreated(created);
      setRows((prev) => prev.filter((item) => item.clientId !== row.clientId));
      setStatus(`Saved ${created.category}`);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save entry";
      setRows((prev) =>
        prev.map((item) =>
          item.clientId === row.clientId ? { ...item, saveError: message } : item
        )
      );
      return false;
    } finally {
      inFlight.current.delete(row.clientId);
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.clientId);
        return next;
      });
    }
  }

  async function saveAllReady() {
    if (saveAllPending || parsing) return;
    setSaveAllPending(true);
    try {
      const readyRows = rows.filter((row) => previewReadiness(row, month).ready);
      for (const row of readyRows) {
        await saveRow(row);
      }
    } finally {
      setSaveAllPending(false);
    }
  }

  function discardRow(clientId: string) {
    if (inFlight.current.has(clientId) || saveAllPending || parsing) return;
    setRows((prev) => prev.filter((item) => item.clientId !== clientId));
    setStatus("Discarded preview");
  }

  function discardAll() {
    if (parsing || saveAllPending || savingIds.size > 0) return;
    setRows([]);
    setStatus("Discarded all previews");
  }

  function fieldWrap(layout: "table" | "card", label: string, child: ReactNode, hint: string) {
    if (layout === "card") {
      return (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 4,
            }}
          >
            {label}
          </div>
          {child}
          <FieldHint text={hint} />
        </div>
      );
    }
    return (
      <td>
        {child}
        <FieldHint text={hint} />
      </td>
    );
  }

  function renderRow(row: PreviewRow, layout: "table" | "card") {
    const { ready, issues } = previewReadiness(row, month);
    const rowSaving = savingIds.has(row.clientId);
    const disabled = rowSaving || saveAllPending || parsing;
    const section = row.section;
    const kind = section === "income" ? "cash" : row.kind;
    const sectionIssues = issuesText(fieldIssues(issues, "section"));
    const dateIssues = issuesText(fieldIssues(issues, "date"));
    const nameIssues = issuesText(fieldIssues(issues, "category"));
    const amountIssues = issuesText(fieldIssues(issues, "amount"));
    const kindIssues = issuesText(fieldIssues(issues, "kind"));
    const txnIssues = issuesText(otherIssues(issues));

    const sectionControl = (
      <button
        type="button"
        className="chip"
        aria-label={
          section
            ? `Section ${SECTION_LABEL[section]}. Activate to cycle.`
            : "Section not set. Activate to choose."
        }
        disabled={disabled}
        onClick={() => {
          const next = nextPreviewSection(section);
          updateRow(
            row.clientId,
            { section: next, kind: next === "income" ? "cash" : row.kind },
            "section"
          );
        }}
        style={{
          background: section ? "var(--accent-soft)" : "var(--surface-2)",
          color: section ? "var(--accent-ink)" : "var(--ink-3)",
          fontWeight: 700,
          border: "none",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {section ? SECTION_LABEL[section] : "Section"}
      </button>
    );

    const dateControl = (
      <DateCell
        value={row.date}
        onChange={(v) => updateRow(row.clientId, { date: v }, "date")}
      />
    );

    const nameControl = (
      <CategoryInput
        value={row.category}
        section={section ?? "daily"}
        placeholder={section ? NAME_PLACEHOLDER[section] : "Transaction name"}
        onChange={(v) => updateRow(row.clientId, { category: v }, "category")}
        onCommit={(v) => updateRow(row.clientId, { category: v }, "category")}
      />
    );

    const amountControl = (
      <AmountInput
        value={row.amount}
        placeholder="0"
        onChange={(n, places) =>
          updateRow(row.clientId, { amount: n, amountDecimalPlaces: places ?? 0 }, "amount")
        }
      />
    );

    const kindControl =
      section === "income" ? (
        <span className="muted" style={{ fontSize: 12 }}>Cash</span>
      ) : (
        <button
          type="button"
          className="chip"
          aria-label={
            kind ? `Kind ${KIND_LABEL[kind]}. Activate to cycle.` : "Kind not set. Activate to choose."
          }
          disabled={disabled}
          onClick={() => updateRow(row.clientId, { kind: nextPreviewKind(row.kind) }, "kind")}
          style={{
            background: kind === "credit" ? "var(--accent-soft)" : "var(--surface-2)",
            color: kind === "credit" ? "var(--accent-ink)" : "var(--ink-3)",
            border: "none",
            cursor: disabled ? "default" : "pointer",
            fontWeight: 600,
          }}
        >
          {kind ? KIND_LABEL[kind] : "Kind"}
        </button>
      );

    const saveControl = (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: layout === "card" ? "flex-end" : "flex-start" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "auto", padding: "6px 12px", height: 32 }}
          disabled={!ready || disabled}
          onClick={() => void saveRow(row)}
          aria-label={`Save ${row.category.trim() || "preview"}`}
        >
          Save
        </button>
        <button
          type="button"
          className="btn btn-soft"
          style={{ width: "auto", padding: "6px 12px", height: 32 }}
          disabled={disabled}
          onClick={() => discardRow(row.clientId)}
          aria-label={`Discard ${row.category.trim() || "preview"}`}
        >
          Discard
        </button>
      </div>
    );

    if (layout === "card") {
      return (
        <div key={row.clientId} className="card card-pad" style={{ opacity: rowSaving ? 0.55 : 1 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            {saveControl}
          </div>
          {fieldWrap(layout, "Section", sectionControl, sectionIssues)}
          {fieldWrap(layout, "Date", dateControl, dateIssues)}
          {fieldWrap(layout, "Transaction name", nameControl, nameIssues)}
          {fieldWrap(layout, "Amount (₹)", amountControl, amountIssues)}
          {fieldWrap(layout, "Kind", kindControl, kindIssues)}
          {txnIssues ? <FieldHint text={txnIssues} /> : null}
          {row.saveError ? (
            <div role="alert" style={{ color: "var(--neg)", fontSize: 13 }}>
              {row.saveError}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <tr key={row.clientId} style={{ opacity: rowSaving ? 0.55 : 1 }}>
        {fieldWrap(layout, "Section", sectionControl, sectionIssues)}
        {fieldWrap(layout, "Date", dateControl, dateIssues)}
        {fieldWrap(layout, "Transaction name", nameControl, nameIssues)}
        {fieldWrap(layout, "Amount", amountControl, amountIssues)}
        {fieldWrap(layout, "Kind", kindControl, kindIssues)}
        <td>
          {saveControl}
          {txnIssues ? <FieldHint text={txnIssues} /> : null}
          {row.saveError ? (
            <div role="alert" style={{ color: "var(--neg)", fontSize: 12, marginTop: 6 }}>
              {row.saveError}
            </div>
          ) : null}
        </td>
      </tr>
    );
  }

  const readyCount = rows.filter((row) => previewReadiness(row, month).ready).length;

  return (
    <div className="card" style={{ overflow: "visible", marginBottom: 20 }} aria-busy={busy}>
      <div className="card-pad" style={{ paddingBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={headingId} style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>
              Describe transactions
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              AI reads everyday language and turns it into previews you can check, then save.
            </p>
          </div>
          <IconSparkles
            size={20}
            style={{ color: "var(--accent)", flex: "none", marginLeft: "auto" }}
            aria-hidden="true"
          />
        </div>
        <textarea
          className="cell-input"
          rows={3}
          value={text}
          disabled={parsing}
          placeholder="spent ₹500 for lunch today, paid Netflix 649 on card"
          aria-labelledby={headingId}
          onChange={(e) => setText(e.target.value)}
          style={{
            width: "100%",
            resize: "vertical",
            minHeight: 72,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={() => void generate()}
            disabled={parsing || anySaving}
          >
            Generate previews
          </button>
          <button
            type="button"
            className="btn btn-soft"
            style={{ width: "auto" }}
            onClick={() => {
              setText("");
              setParseErr("");
            }}
            disabled={parsing || !text}
          >
            Clear
          </button>
        </div>
        {parseErr ? (
          <div role="alert" style={{ marginTop: 10, color: "var(--neg)", fontSize: 13 }}>
            {parseErr}
          </div>
        ) : null}
        <div id={statusId} aria-live="polite" className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
          {parsing ? "Generating previews…" : status}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="ai-preview-toolbar">
            <span className="muted" style={{ fontSize: 12 }}>
              {readyCount} of {rows.length} ready
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={readyCount === 0 || busy}
                onClick={() => void saveAllReady()}
              >
                Save all ready
              </button>
              <button
                type="button"
                className="btn btn-soft"
                disabled={busy}
                onClick={discardAll}
              >
                Discard all
              </button>
            </div>
          </div>

          {stacked ? (
            <div className="ai-preview-cards">{rows.map((row) => renderRow(row, "card"))}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Section</th>
                    <th style={{ width: 158 }}>Date</th>
                    <th style={{ minWidth: 180 }}>Transaction name</th>
                    <th style={{ width: 130 }}>Amount (₹)</th>
                    <th style={{ width: 110 }}>Kind</th>
                    <th style={{ width: 170 }} />
                  </tr>
                </thead>
                <tbody>{rows.map((row) => renderRow(row, "table"))}</tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
