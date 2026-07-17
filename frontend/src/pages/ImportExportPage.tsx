import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { exportTransactions, importTransactions } from "../api/ledger";
import { AmountInput, DateCell, RowCategoryInput } from "../components/record/TableCells";
import { IconCheck, IconDownload, IconExport, IconX } from "../components/ui/Icons";
import { currentMonth } from "../lib/dates";
import { defaultExportRange, downloadBlob, isValidExportRange } from "../lib/export";
import {
  allRowsValid,
  countRowErrors,
  parseImportCSV,
  revalidateRows,
  toImportPayload,
  type ImportParsedRow,
} from "../lib/import";
import { invalidateImportCaches } from "../lib/monthCaches";
import type { Section, TxnKind } from "../types";

const SECTIONS: Section[] = ["essential", "flexible", "daily", "income"];
const KINDS: TxnKind[] = ["cash", "credit"];

function ImportReviewTable({
  rows,
  onChange,
  onRemove,
}: {
  rows: ImportParsedRow[];
  onChange: (rows: ImportParsedRow[]) => void;
  onRemove: (index: number) => void;
}) {
  function updateRow(index: number, patch: Partial<ImportParsedRow["row"]>) {
    const next = rows.map((r, i) => {
      if (i !== index) return r;
      const row = { ...r.row, ...patch };
      return { row, errors: {} as ImportParsedRow["errors"] };
    });
    onChange(revalidateRows(next));
  }

  return (
    <div style={{ overflowX: "auto", marginTop: 16 }}>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 158 }}>Date</th>
            <th style={{ width: 120 }}>Section</th>
            <th style={{ minWidth: 180 }}>Category</th>
            <th style={{ width: 130 }}>Amount</th>
            <th style={{ width: 100 }}>Kind</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={Object.keys(r.errors).length > 0 ? { background: "oklch(0.97 0.03 25 / 0.35)" } : undefined}>
              <td>
                <DateCell value={r.row.date} onChange={(v) => updateRow(i, { date: v })} />
                {r.errors.date && <div className="import-field-err">{r.errors.date}</div>}
              </td>
              <td>
                <select
                  className="cell-input"
                  value={r.row.section}
                  onChange={(e) => updateRow(i, { section: e.target.value as Section })}
                >
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {r.errors.section && <div className="import-field-err">{r.errors.section}</div>}
              </td>
              <td>
                <RowCategoryInput value={r.row.category} onChange={(v) => updateRow(i, { category: v })} />
                {r.errors.category && <div className="import-field-err">{r.errors.category}</div>}
              </td>
              <td>
                <AmountInput value={r.row.amount} onChange={(v) => updateRow(i, { amount: v })} />
                {r.errors.amount && <div className="import-field-err">{r.errors.amount}</div>}
              </td>
              <td>
                <select
                  className="cell-input"
                  value={r.row.kind}
                  onChange={(e) => updateRow(i, { kind: e.target.value as TxnKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                {r.errors.kind && <div className="import-field-err">{r.errors.kind}</div>}
              </td>
              <td>
                <button className="x-btn" onClick={() => onRemove(i)} aria-label="Remove row">
                  <IconX size={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportExportPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const initialRange = useMemo(() => defaultExportRange(currentMonth()), []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [exportError, setExportError] = useState("");
  const [exported, setExported] = useState(false);

  const [importRows, setImportRows] = useState<ImportParsedRow[]>([]);
  const [importFileError, setImportFileError] = useState("");
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState<number | null>(null);

  const exportValidationError = isValidExportRange(from, to);

  const exportMut = useMutation({
    mutationFn: () => exportTransactions(from, to),
    onMutate: () => {
      setExportError("");
      setExported(false);
    },
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename);
      setExported(true);
      setTimeout(() => setExported(false), 2200);
    },
    onError: (e) => {
      setExportError(e instanceof Error ? e.message : "Export failed");
    },
  });

  const importMut = useMutation({
    mutationFn: async () => {
      const payload = toImportPayload(importRows);
      return importTransactions(payload);
    },
    onMutate: () => {
      setImportError("");
      setImported(null);
    },
    onSuccess: (res) => {
      setImported(res.imported);
      setImportRows([]);
      if (fileRef.current) fileRef.current.value = "";
      invalidateImportCaches(qc, res.months);
    },
    onError: (e) => {
      setImportError(e instanceof Error ? e.message : "Import failed");
    },
  });

  function submitExport() {
    if (exportValidationError) {
      setExportError(exportValidationError);
      return;
    }
    exportMut.mutate();
  }

  function onFileChange(file: File | undefined) {
    setImportFileError("");
    setImportError("");
    setImported(null);
    if (!file) {
      setImportRows([]);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const { rows, fileError } = parseImportCSV(text);
      if (fileError) {
        setImportFileError(fileError);
        setImportRows([]);
        return;
      }
      setImportRows(rows);
    };
    reader.onerror = () => {
      setImportFileError("Could not read file.");
      setImportRows([]);
    };
    reader.readAsText(file);
  }

  function removeRow(index: number) {
    setImportRows((prev) => revalidateRows(prev.filter((_, i) => i !== index)));
  }

  const importErrorCount = countRowErrors(importRows);
  const canImport = importRows.length > 0 && allRowsValid(importRows);
  const shownExportError = exportError || exportValidationError;

  return (
    <div className="content fade-in" style={{ maxWidth: 960 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Import / Export</h1>
          <p className="page-sub">Move transaction data in and out of Pennywise.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <h3 className="card-h" style={{ marginBottom: 4 }}>
          <IconExport size={15} /> Export transactions
        </h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
          Export cash and credit transactions for a date range of up to 6 months. Settlement rows are not included.
          Income is included. Both start and end dates are included.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 20 }}>
          <div className="field">
            <label>From</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label>To</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {shownExportError && (
          <div style={{ color: "var(--neg)", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            {shownExportError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={submitExport}
            disabled={exportMut.isPending || !!exportValidationError}
          >
            {exportMut.isPending ? "Exporting..." : "Export CSV"}
          </button>
          {exported && (
            <span style={{ color: "var(--pos)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <IconCheck size={15} /> Download started
            </span>
          )}
        </div>
      </div>

      <div className="card card-pad">
        <h3 className="card-h" style={{ marginBottom: 4 }}>
          <IconDownload size={15} /> Import transactions
        </h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
          Upload a Pennywise export CSV. Review and fix any errors, then import. Settlement rows are rejected.
          Category mappings are not applied — map new categories manually after import.
        </p>

        <div style={{ marginTop: 18 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="input"
            onChange={(e) => onFileChange(e.target.files?.[0])}
          />
        </div>

        {(importFileError || importError) && (
          <div style={{ color: "var(--neg)", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            {importFileError || importError}
          </div>
        )}

        {importRows.length > 0 && (
          <>
            <div className="import-summary" style={{ marginTop: 14 }}>
              {importRows.length} row{importRows.length === 1 ? "" : "s"}
              {importErrorCount > 0
                ? ` · ${importErrorCount} with errors · fix all errors to import`
                : " · ready to import"}
            </div>
            <ImportReviewTable rows={importRows} onChange={setImportRows} onRemove={removeRow} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
              <button
                className="btn btn-primary"
                style={{ width: "auto" }}
                onClick={() => importMut.mutate()}
                disabled={importMut.isPending || !canImport}
              >
                {importMut.isPending ? "Importing..." : `Import ${importRows.length} row${importRows.length === 1 ? "" : "s"}`}
              </button>
              <button
                className="btn btn-soft"
                style={{ width: "auto" }}
                onClick={() => {
                  setImportRows([]);
                  setImportFileError("");
                  setImportError("");
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Clear
              </button>
            </div>
          </>
        )}

        {imported !== null && importRows.length === 0 && (
          <span style={{ color: "var(--pos)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, marginTop: 14 }}>
            <IconCheck size={15} /> Imported {imported} transaction{imported === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
