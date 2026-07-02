import type { QueryClient } from "@tanstack/react-query";

export function invalidateMonthCaches(qc: QueryClient, month: string): void {
  qc.invalidateQueries({ queryKey: ["open-month", month] });
  qc.invalidateQueries({ queryKey: ["txns", "month", month] });
  qc.invalidateQueries({ queryKey: ["dashboard", "monthly", month] });
  qc.invalidateQueries({ queryKey: ["group-spend", month] });
  qc.invalidateQueries({ queryKey: ["daily-suggestions"] });
}

export function invalidateImportCaches(qc: QueryClient, months: string[], sections: Set<string>): void {
  months.forEach((m) => invalidateMonthCaches(qc, m));
  if (sections.has("income")) {
    qc.invalidateQueries({ queryKey: ["income-suggestions"] });
  }
}
