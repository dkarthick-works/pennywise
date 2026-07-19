import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTxnsByMonth, importTransactions, updateTxn } from "../../api/ledger";
import { buildCopyLastMonthPlan, type CopyLastMonthPlan } from "../../lib/copyLastMonth";
import { shiftMonth, monthLabel, MONTH_NAMES } from "../../lib/dates";
import { invalidateImportCaches } from "../../lib/monthCaches";
import { IconDownload } from "../ui/Icons";
import type { Section, Transaction } from "../../types";

const SECTION_LABEL: Record<Section, string> = {
  essential: "Essential",
  flexible: "Flexible",
  daily: "Daily",
  income: "Income",
};

type Phase = "idle" | "loading" | "confirming" | "writing";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function monthName(monthKey: string): string {
  return MONTH_NAMES[+monthKey.slice(5) - 1];
}

function confirmText(plan: CopyLastMonthPlan, prevLabel: string, curLabel: string): string {
  const clauses: string[] = [];
  if (plan.fills.length > 0) {
    clauses.push(`${plural(plan.fills.length, "existing zero-value cash row", "existing zero-value cash rows")} will be filled`);
  }
  if (plan.inserts.length > 0) {
    clauses.push(`${plural(plan.inserts.length, "new row", "new rows")} will be added`);
  }
  const detail = clauses.length > 0 ? `${clauses.join(" and ")}. ` : "";
  return `Copy ${plural(plan.eligibleCount, "transaction", "transactions")} from ${prevLabel} into ${curLabel}? ${detail}Other existing rows will not be replaced.`;
}

function successText(inserted: number, filled: number, fillAttempted: number, prevMonthName: string): string {
  const parts: string[] = [];
  if (inserted > 0) parts.push(`Added ${plural(inserted, "row", "rows")}`);
  if (fillAttempted > 0) {
    parts.push(
      filled < fillAttempted
        ? `filled ${filled} of ${fillAttempted} matching rows`
        : `filled ${plural(filled, "matching zero-value row", "matching zero-value rows")}`
    );
  }
  let msg = `${parts.join("; ")} from ${prevMonthName}.`;
  // Only warn against retrying when new rows were actually inserted — a retry
  // would re-import those. A fills-only run has nothing to duplicate.
  if (inserted > 0 && filled < fillAttempted) {
    msg += " Do not retry — that would add the new rows again.";
  }
  return msg;
}

/**
 * "Copy last month" control for the Income, Essential and Flexible tiles.
 * Loads the previous month, previews a plan, confirms with exact counts, then
 * runs atomic inserts (importTransactions) plus best-effort fills (updateTxn).
 * The overall operation is not atomic — a partial fill warns against retrying.
 */
export function CopyLastMonthButton({
  section,
  month,
  currentTxns,
  onPendingChange,
  onCopied,
}: {
  section: Section;
  month: string;
  currentTxns: Transaction[];
  onPendingChange: (pending: boolean) => void;
  onCopied?: () => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<CopyLastMonthPlan | null>(null);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  const prev = shiftMonth(month, -1);
  const prevLabel = monthLabel(prev);
  const curLabel = monthLabel(month);
  const sectionLabel = SECTION_LABEL[section];
  const busy = phase !== "idle";

  function settle(next: { text: string; tone: "info" | "error" } | null) {
    setPlan(null);
    setPhase("idle");
    onPendingChange(false);
    setStatus(next);
  }

  async function start() {
    setStatus(null);
    setPhase("loading");
    onPendingChange(true);

    let sourceTxns: Transaction[];
    try {
      sourceTxns = await getTxnsByMonth(prev);
    } catch {
      settle({ text: `Couldn't load ${prevLabel} transactions. Try again.`, tone: "error" });
      return;
    }

    const built = buildCopyLastMonthPlan({ section, targetMonth: month, sourceTxns, currentTxns });
    if (built.eligibleCount === 0) {
      settle({ text: `No eligible ${sectionLabel} transactions in ${prevLabel}.`, tone: "info" });
      return;
    }

    setPlan(built);
    setPhase("confirming");
  }

  function cancel() {
    // Discriminated cancel: no writes, no cache work, no success message.
    setPlan(null);
    setPhase("idle");
    onPendingChange(false);
  }

  async function confirm() {
    if (!plan) return;
    setPhase("writing");
    const { fills, inserts } = plan;

    let importedMonths: string[] = [];
    if (inserts.length > 0) {
      try {
        const res = await importTransactions(inserts);
        importedMonths = res.months ?? [];
      } catch {
        settle({ text: "Couldn't copy transactions. No rows were added.", tone: "error" });
        return;
      }
    }

    let filled = 0;
    if (fills.length > 0) {
      const results = await Promise.allSettled(fills.map((f) => updateTxn(f.id, f.patch)));
      filled = results.filter((r) => r.status === "fulfilled").length;
    }

    const months = Array.from(new Set([...importedMonths, month]));
    invalidateImportCaches(qc, months);

    const partial = filled < fills.length;
    setPlan(null);
    setPhase("idle");
    onPendingChange(false);
    setStatus({
      text: successText(inserts.length, filled, fills.length, monthName(prev)),
      tone: partial ? "error" : "info",
    });
    onCopied?.();
  }

  return (
    <>
      <button
        className="btn btn-soft"
        onClick={start}
        disabled={busy}
        title={`Copy eligible ${sectionLabel} transactions from ${prevLabel}`}
      >
        <IconDownload size={15} />
        {phase === "loading" ? "Loading…" : phase === "writing" ? "Copying…" : "Copy last month"}
      </button>

      {phase === "confirming" && plan && (
        <div
          role="dialog"
          aria-label="Confirm copy last month"
          style={{
            flexBasis: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "10px 12px",
            borderRadius: 10,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--ink-2)", flex: 1, minWidth: 220 }}>
            {confirmText(plan, prevLabel, curLabel)}
          </span>
          <button className="btn btn-primary" onClick={confirm}>Copy</button>
          <button className="btn btn-soft" onClick={cancel}>Cancel</button>
        </div>
      )}

      {status && (
        <span
          role="status"
          aria-live="polite"
          style={{
            flexBasis: "100%",
            fontSize: 12.5,
            color: status.tone === "error" ? "var(--neg)" : "var(--ink-3)",
          }}
        >
          {status.text}
        </span>
      )}
    </>
  );
}
