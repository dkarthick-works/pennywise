export type ParsedAmount = {
  value: number | null;
  decimalPlaces: number;
  /** True when the typed text included a minus sign, including signed zero. */
  negative: boolean;
};

/** Shown when a transaction amount is negative. Zero is a separate check. */
export const POSITIVE_AMOUNT_MESSAGE = "Amount must be greater than 0";

const EMPTY_AMOUNT: ParsedAmount = { value: null, decimalPlaces: 0, negative: false };

/** Display rupees with Indian grouping and `.` as the decimal point. */
export function formatIndianAmount(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 20 });
}

function isMinusSign(ch: string): boolean {
  // Hyphen-minus and the Unicode minus both mean the user typed a negative amount.
  return ch === "-" || ch === "−";
}

/**
 * Parse user-typed money. Commas are grouping only; `.` is the decimal point.
 * Extra dots after the first are ignored. A minus sign is kept as a negative
 * value so callers can reject it. Other non-digits are ignored.
 */
export function parseIndianAmount(raw: string): ParsedAmount {
  const trimmed = raw.trim();
  if (!trimmed) return EMPTY_AMOUNT;

  let seenDot = false;
  let negative = false;
  let out = "";
  for (const ch of trimmed) {
    if (ch === ",") continue;
    if (isMinusSign(ch)) {
      negative = true;
      continue;
    }
    if (ch === ".") {
      if (seenDot) continue;
      seenDot = true;
      out += ".";
      continue;
    }
    if (ch >= "0" && ch <= "9") out += ch;
  }

  if (!out || out === ".") return { value: null, decimalPlaces: 0, negative };

  let n = Number(out);
  if (!Number.isFinite(n)) return { value: null, decimalPlaces: 0, negative };
  if (negative && n !== 0) n = -n;

  const dot = out.indexOf(".");
  const decimalPlaces = dot === -1 ? 0 : out.length - dot - 1;
  return { value: n, decimalPlaces, negative };
}

export function isNegativeAmount(parsed: ParsedAmount): boolean {
  return parsed.negative || (parsed.value != null && parsed.value < 0);
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
