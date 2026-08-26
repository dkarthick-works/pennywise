import type { Section, TxnKind } from "../types";

export const SECTIONS: Section[] = ["essential", "flexible", "daily", "income"];
export const KINDS: TxnKind[] = ["cash", "credit", "settlement"];
export const PREVIEW_KINDS: TxnKind[] = ["cash", "credit"];

export const SECTION_LABEL: Record<Section, string> = {
  essential: "Bare Minimum",
  flexible: "Subscriptions",
  daily: "Daily / Running",
  income: "Income",
};

export const KIND_LABEL: Record<TxnKind, string> = {
  cash: "Cash",
  credit: "Credit",
  settlement: "Settlement",
};

export function nextSection(current: Section): Section {
  return SECTIONS[(SECTIONS.indexOf(current) + 1) % SECTIONS.length];
}

export function nextKind(current: TxnKind): TxnKind {
  return KINDS[(KINDS.indexOf(current) + 1) % KINDS.length];
}

export function nextPreviewSection(current: Section | null): Section {
  if (!current) return "daily";
  return nextSection(current);
}

export function nextPreviewKind(current: TxnKind | null): TxnKind {
  if (current === "cash") return "credit";
  return "cash";
}
