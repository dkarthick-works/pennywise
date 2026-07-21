import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listChits } from "../api/chits";
import { IconPlus } from "../components/ui/Icons";
import { startMonthToMonth } from "../lib/chits";
import { inr } from "../lib/money";
import type { ChitStatus } from "../types";

function StatusChip({ status }: { status: ChitStatus }) {
  if (status === "completed") {
    return <span className="chip chip-paid">Completed</span>;
  }
  return <span className="chip chip-pending">Active</span>;
}

export function ChitsPage() {
  const navigate = useNavigate();

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ["chits"],
    queryFn: listChits,
  });

  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Chit funds</h1>
          <p className="page-sub">
            Schemes you subscribe to — tracked separately from expenses, dashboard totals, insights, and CSV exports.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "auto", padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={() => navigate("/chits/new")}
          aria-label="Add a chit"
        >
          <IconPlus size={16} /> Add chit
        </button>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        {isLoading ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>Loading chits…</p>
        ) : isError ? (
          <p style={{ margin: 0, padding: 18, color: "var(--neg)", fontSize: 13 }}>
            Could not load chits.
          </p>
        ) : data.length === 0 ? (
          <p className="muted" style={{ margin: 0, padding: 18, fontSize: 13 }}>
            No chits yet. Use Add chit to record a scheme you subscribe to.
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Organizer</th>
                <th style={{ textAlign: "right" }}>Chit value</th>
                <th>Start</th>
                <th>Progress</th>
                <th style={{ textAlign: "right" }}>Total paid</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => navigate(`/chits/${c.id}`)}
                >
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.organizer}</td>
                  <td className="num" style={{ textAlign: "right" }}>{inr(c.chit_value)}</td>
                  <td className="muted">{startMonthToMonth(c.start_month) || c.start_month}</td>
                  <td>
                    {c.installment_count} / {c.total_installments}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>{inr(c.total_paid)}</td>
                  <td><StatusChip status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
