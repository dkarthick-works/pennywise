import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { exportTransactions } from "../api/ledger";
import { IconCheck, IconExport } from "../components/ui/Icons";
import { currentMonth } from "../lib/dates";
import { defaultExportRange, downloadBlob, isValidExportRange } from "../lib/export";

export function ExportPage() {
  const initialRange = useMemo(() => defaultExportRange(currentMonth()), []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [error, setError] = useState("");
  const [exported, setExported] = useState(false);

  const validationError = isValidExportRange(from, to);

  const exportMut = useMutation({
    mutationFn: () => exportTransactions(from, to),
    onMutate: () => {
      setError("");
      setExported(false);
    },
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename);
      setExported(true);
      setTimeout(() => setExported(false), 2200);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Export failed");
    },
  });

  function submit() {
    if (validationError) {
      setError(validationError);
      return;
    }
    exportMut.mutate();
  }

  const shownError = error || validationError;

  return (
    <div className="content fade-in" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Export</h1>
          <p className="page-sub">Download transaction data for moving it between systems.</p>
        </div>
      </div>

      <div className="card card-pad">
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

        {shownError && (
          <div style={{ color: "var(--neg)", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
            {shownError}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={submit}
            disabled={exportMut.isPending || !!validationError}
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
    </div>
  );
}
