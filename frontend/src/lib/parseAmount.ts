export type ParsedAmount = {
  value: number | null;
  decimalPlaces: number;
};

/** Display rupees with Indian grouping and `.` as the decimal point. */
export function formatIndianAmount(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 20 });
}

/**
 * Parse user-typed money. Commas are grouping only; `.` is the decimal point.
 * Extra dots after the first are ignored. Non-digits are stripped.
 */
export function parseIndianAmount(raw: string): ParsedAmount {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, decimalPlaces: 0 };

  let seenDot = false;
  let out = "";
  for (const ch of trimmed) {
    if (ch === ",") continue;
    if (ch === ".") {
      if (seenDot) continue;
      seenDot = true;
      out += ".";
      continue;
    }
    if (ch >= "0" && ch <= "9") out += ch;
  }

  if (!out || out === ".") return { value: null, decimalPlaces: 0 };

  const n = Number(out);
  if (!Number.isFinite(n)) return { value: null, decimalPlaces: 0 };

  const dot = out.indexOf(".");
  const decimalPlaces = dot === -1 ? 0 : out.length - dot - 1;
  return { value: n, decimalPlaces };
}

export function countDecimalPlaces(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const s = String(value);
  if (/e/i.test(s)) {
    const fixed = value.toFixed(10).replace(/0+$/, "");
    const i = fixed.indexOf(".");
    return i === -1 ? 0 : fixed.length - i - 1;
  }
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

export function amountHasAtMostTwoDecimals(decimalPlaces: number): boolean {
  return decimalPlaces <= 2;
}
