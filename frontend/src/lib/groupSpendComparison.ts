import type { GroupSpendHistoryBucket, MonthlyCostHistoryBucket } from "../types";
export type ComparisonRange = 3 | 6 | 12;

export function normalizeComparisonRange(value: string | null): ComparisonRange {
  const parsed = Number(value);
  return parsed === 3 || parsed === 12 ? parsed : 6;
}

export function isMonthKey(value: string | null): value is string {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

export function periodAverage(buckets: GroupSpendHistoryBucket[]): number {
  if (buckets.length === 0) return 0;
  return buckets.reduce((sum, bucket) => sum + bucket.total, 0) / buckets.length;
}

export type PreviousMonthComparison =
  | { kind: "both-empty" }
  | { kind: "new"; delta: number }
  | { kind: "now-empty"; delta: number }
  | { kind: "changed"; delta: number; percentage: number | null };

export function compareWithPrevious(
  current: GroupSpendHistoryBucket,
  previous: GroupSpendHistoryBucket
): PreviousMonthComparison {
  if (previous.transaction_count === 0 && current.transaction_count === 0) {
    return { kind: "both-empty" };
  }
  if (previous.transaction_count === 0) {
    return { kind: "new", delta: current.total };
  }
  if (current.transaction_count === 0) {
    return { kind: "now-empty", delta: -previous.total };
  }
  const delta = current.total - previous.total;
  return {
    kind: "changed",
    delta,
    percentage: previous.total === 0 ? null : (delta / previous.total) * 100,
  };
}

export function monthlyCostShare(
  bucket: GroupSpendHistoryBucket,
  costs: MonthlyCostHistoryBucket[]
): number | null {
  const monthlyCost = costs.find((cost) => cost.month === bucket.month)?.total ?? 0;
  return monthlyCost === 0 ? null : (bucket.total / monthlyCost) * 100;
}

export function contributionPercentage(total: number, groupTotal: number): number | null {
  return groupTotal === 0 ? null : (total / groupTotal) * 100;
}
