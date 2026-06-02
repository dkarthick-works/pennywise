// Currency helpers — port of inr() / inrShort() from data.jsx

export function inr(n: number, opts: { noSymbol?: boolean } = {}): string {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toLocaleString("en-IN");
  const sign = v < 0 ? "−" : "";
  return (opts.noSymbol ? "" : "₹") + sign + s;
}

export function inrShort(n: number): string {
  const v = Math.abs(Math.round(n || 0));
  if (v >= 100_000) return "₹" + (v / 100_000).toFixed(v % 100_000 === 0 ? 0 : 1) + "L";
  if (v >= 1000)    return "₹" + (v / 1000).toFixed(0) + "k";
  return "₹" + v;
}

export function budgetColor(ratio: number): string {
  if (ratio > 1)   return "var(--neg)";
  if (ratio >= 0.8) return "var(--amber)";
  return "var(--pos)";
}
