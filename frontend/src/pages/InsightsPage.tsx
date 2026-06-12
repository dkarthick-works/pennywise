import { useQuery } from "@tanstack/react-query";
import { getInsights } from "../api/ledger";
import { inr } from "../lib/money";
import { IconShield } from "../components/ui/Icons";

function TierCard({
  label,
  multiplier,
  amount,
  muted,
}: {
  label: string;
  multiplier: number;
  amount: number;
  muted?: boolean;
}) {
  return (
    <div className="card card-pad">
      <div className="stat-lbl" style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11, marginBottom: 8 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: muted ? 22 : 25, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {inr(amount)}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        {multiplier} months × essential spend
      </p>
    </div>
  );
}

export function InsightsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["insights"],
    queryFn: getInsights,
  });

  const seed = data?.seed_amount ?? 0;
  const comfort = data?.emergency_fund.comfort ?? { multiplier: 6, amount: 0 };
  const bare = data?.emergency_fund.bare ?? { multiplier: 3, amount: 0 };
  const luxury = data?.emergency_fund.luxury ?? { multiplier: 12, amount: 0 };

  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Insights</h1>
          <p className="page-sub">Your financial safety net at a glance.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="card card-pad">
          <p className="muted">Loading insights…</p>
        </div>
      ) : (
        <>
          <div className="card card-pad" style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "var(--accent-soft)",
                  color: "var(--accent-ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <IconShield size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="stat-lbl"
                  style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 11, marginBottom: 6 }}
                >
                  Emergency fund target
                </div>
                <div className="num" style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.15 }}>
                  {inr(comfort.amount)}
                </div>
                <p className="muted" style={{ fontSize: 13, margin: "10px 0 0" }}>
                  {comfort.multiplier} months × {inr(seed)} · highest Essential spend (last 3 months)
                </p>
                {seed === 0 && (
                  <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
                    Add Essential transactions to calculate your emergency fund target.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <TierCard label="Bare" multiplier={bare.multiplier} amount={bare.amount} muted />
            <TierCard label="Luxury" multiplier={luxury.multiplier} amount={luxury.amount} muted />
          </div>
        </>
      )}
    </div>
  );
}
