// SVG charts — port of charts.jsx
import { inr, inrShort } from "../../lib/money";

// ─── Donut ────────────────────────────────────────────────────────────────

interface DonutSeg {
  label: string;
  value: number;
  color: string;
}
interface DonutProps {
  segments: DonutSeg[];
  centerTop?: string;
  centerBot?: string;
  size?: number;
  thick?: number;
}

export function Donut({ segments, centerTop, centerBot, size = 168, thick = 22 }: DonutProps) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thick) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let acc = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--border)" strokeWidth={thick} />
      {segments.map((s, i) => {
        const frac = s.value / total;
        const dash = frac * c;
        const off = acc * c;
        acc += frac;
        return (
          <circle
            key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.color}
            strokeWidth={thick} strokeLinecap="butt"
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-off}
            transform={`rotate(-90 ${cx} ${cx})`}
            style={{ transition: "stroke-dasharray .6s cubic-bezier(.4,0,.2,1)" }}
          />
        );
      })}
      {centerTop && (
        <text x={cx} y={cx - 4} textAnchor="middle" className="num"
          style={{ fontSize: 21, fontWeight: 700, fill: "var(--ink)" }}>
          {centerTop}
        </text>
      )}
      {centerBot && (
        <text x={cx} y={cx + 15} textAnchor="middle"
          style={{ fontSize: 11, fontWeight: 600, fill: "var(--ink-3)", letterSpacing: ".04em", textTransform: "uppercase" }}>
          {centerBot}
        </text>
      )}
    </svg>
  );
}

// ─── YearBars ─────────────────────────────────────────────────────────────

interface BarDatum {
  label: string;
  value: number;
}
interface YearBarsProps {
  data: BarDatum[];
  height?: number;
  accent?: string;
  highlight?: string;
}

export function YearBars({ data, height = 200, accent = "var(--accent)", highlight }: YearBarsProps) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 640, padL = 8, padR = 8, padB = 26, padT = 14;
  const innerW = W - padL - padR;
  const bw = innerW / data.length;
  const barW = Math.min(34, bw * 0.56);
  const innerH = height - padB - padT;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      {[0.25, 0.5, 0.75, 1].map((g, i) => (
        <line
          key={i} x1={padL} x2={W - padR}
          y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)}
          stroke="var(--border-2)" strokeWidth="1" strokeDasharray="2 4"
        />
      ))}
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = padL + i * bw + (bw - barW) / 2;
        const y = padT + innerH - h;
        const isHi = highlight === d.label;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={Math.max(h, 1)} rx="5"
              fill={isHi ? accent : "var(--accent-soft)"}
              stroke={isHi ? "none" : "var(--accent)"} strokeOpacity="0.35"
              style={{ transition: "y .5s cubic-bezier(.4,0,.2,1), height .5s cubic-bezier(.4,0,.2,1)" }}
            >
              <title>{d.label}: {inr(d.value)}</title>
            </rect>
            <text
              x={x + barW / 2} y={height - 8} textAnchor="middle"
              style={{ fontSize: 11, fontWeight: 600, fill: isHi ? "var(--ink)" : "var(--ink-3)" }}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── BudgetBars ───────────────────────────────────────────────────────────
// Two-bar design: actual (section colour) + budget (muted grey) on a shared
// scale. If the actual bar is wider than the budget bar → over budget.

interface BudgetBarRow {
  label: string;
  color: string;
  actual: number;
  budget: number;
}
interface BudgetBarsProps {
  rows: BudgetBarRow[];
}

export function BudgetBars({ rows }: BudgetBarsProps) {
  const max = Math.max(...rows.flatMap((r) => [r.actual, r.budget]), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {rows.map((r, i) => (
        <div key={i}>
          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, fontSize: 13 }}>
            <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
              <span className="dot" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="num" style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {inr(r.actual)}
              <span style={{ color: "var(--ink-3)", margin: "0 4px" }}>/</span>
              <span style={{ color: "var(--ink-3)" }}>{inr(r.budget)}</span>
            </span>
          </div>

          {/* Actual bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: r.color, width: 36, textAlign: "right", flexShrink: 0, letterSpacing: "0.02em" }}>
              Actual
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: 100, background: "var(--border)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min((r.actual / max) * 100, 100)}%`,
                background: r.color,
                borderRadius: 100,
                transition: "width .55s cubic-bezier(.4,0,.2,1)",
                minWidth: r.actual > 0 ? 4 : 0,
              }} />
            </div>
          </div>

          {/* Budget bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--ink-3)", width: 36, textAlign: "right", flexShrink: 0, letterSpacing: "0.02em" }}>
              Budget
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: 100, background: "var(--border)", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: `${Math.min((r.budget / max) * 100, 100)}%`,
                background: "var(--ink-3)",
                opacity: 0.3,
                borderRadius: 100,
                transition: "width .55s cubic-bezier(.4,0,.2,1)",
                minWidth: r.budget > 0 ? 4 : 0,
              }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Re-export helper for callers that need inrShort in chart tooltips
export { inrShort };
