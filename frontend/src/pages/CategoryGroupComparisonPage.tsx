import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getCategoryGroups,
  getGroupSpendHistory,
  groupSpendHistoryKeys,
} from "../api/ledger";
import { IconCategories, IconChevL, IconTrend } from "../components/ui/Icons";
import { monthLabel } from "../lib/dates";
import {
  compareWithPrevious,
  contributionPercentage,
  isMonthKey,
  monthlyCostShare,
  normalizeComparisonRange,
  periodAverage,
  type ComparisonRange,
} from "../lib/groupSpendComparison";
import { inr } from "../lib/money";
import type { GroupCategoryContribution, GroupSpendHistoryBucket } from "../types";

function pct(value: number): string {
  return `${Math.abs(value).toFixed(1).replace(/\.0$/, "")}%`;
}

function comparisonText(current: GroupSpendHistoryBucket, previous: GroupSpendHistoryBucket): string {
  const comparison = compareWithPrevious(current, previous);
  if (comparison.kind === "both-empty") return "No transactions in either month";
  if (comparison.kind === "new") return "New spending · no transactions last month";
  if (comparison.kind === "now-empty") return `No spending this month · down ${inr(Math.abs(comparison.delta))}`;
  const direction = comparison.delta >= 0 ? "Up" : "Down";
  const percentage = comparison.percentage == null ? "" : ` · ${pct(comparison.percentage)}`;
  return `${direction} ${inr(Math.abs(comparison.delta))}${percentage} from ${monthLabel(previous.month)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-pad">
      <div className="stat-lbl" style={{ marginBottom: 7 }}>{label}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

type ContributionSort = "amount-desc" | "amount-asc" | "transactions" | "category";

function ContributionTable({
  groupName,
  month,
  categories,
  groupTotal,
}: {
  groupName: string;
  month: string;
  categories: GroupCategoryContribution[];
  groupTotal: number;
}) {
  const [sortBy, setSortBy] = useState<ContributionSort>("amount-desc");
  const [showAll, setShowAll] = useState(false);
  const sorted = [...categories].sort((a, b) => {
    if (sortBy === "amount-asc") return a.total - b.total || a.category.localeCompare(b.category);
    if (sortBy === "transactions") return b.transaction_count - a.transaction_count || b.total - a.total;
    if (sortBy === "category") return a.category.localeCompare(b.category);
    return b.total - a.total || a.category.localeCompare(b.category);
  });
  const visible = showAll ? sorted : sorted.slice(0, 10);
  const maxAmount = Math.max(1, ...categories.map((category) => category.total));

  return (
    <section className="card contribution-card" aria-labelledby="contribution-title">
      <div className="contribution-head">
        <div className="contribution-title-wrap">
          <span className="contribution-title-icon" aria-hidden="true"><IconCategories size={24} /></span>
          <div>
            <h3 id="contribution-title" className="contribution-title">{groupName} spending</h3>
            <p>Where this group’s {monthLabel(month)} spend came from.</p>
          </div>
        </div>
        <label className="contribution-sort">
          <IconTrend size={18} aria-hidden="true" />
          <span><small>Sort by</small>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ContributionSort)} aria-label="Sort category spending">
              <option value="amount-desc">Amount (High to Low)</option>
              <option value="amount-asc">Amount (Low to High)</option>
              <option value="transactions">Transactions</option>
              <option value="category">Category name</option>
            </select>
          </span>
        </label>
      </div>

      {categories.length === 0 || groupTotal === 0 ? (
        <p className="muted contribution-empty">No category contributions for this month.</p>
      ) : (
        <>
          <div className="contribution-table-wrap">
            <table className="contribution-table">
              <thead>
                <tr><th>Category</th><th>Amount</th><th>% of total</th><th>Transactions</th></tr>
              </thead>
              <tbody>
                {visible.map((category) => {
                  const percentage = contributionPercentage(category.total, groupTotal) ?? 0;
                  return (
                    <tr key={category.category}>
                      <td>
                        <span className="contribution-category-name">{category.category}</span>
                        <span className="contribution-track" aria-hidden="true">
                          <i style={{ width: `${Math.max(1, (category.total / maxAmount) * 100)}%` }} />
                        </span>
                      </td>
                      <td className="num contribution-amount">{inr(category.total)}</td>
                      <td className="num">{pct(percentage)}</td>
                      <td><span className="contribution-count">{category.transaction_count}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {categories.length > 10 && (
            <button type="button" className="contribution-toggle" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show top 10" : `View all ${categories.length} categories`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function HistoryBars({
  buckets,
  anchorMonth,
  onMonth,
}: {
  buckets: GroupSpendHistoryBucket[];
  anchorMonth: string;
  onMonth: (month: string) => void;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.total));
  return (
    <div
      role="group"
      aria-label={`Category group spend from ${monthLabel(buckets[0]?.month ?? "")} to ${monthLabel(anchorMonth)}`}
      style={{ display: "grid", gridTemplateColumns: `repeat(${buckets.length}, minmax(34px, 1fr))`, gap: 8, alignItems: "end", minHeight: 230, overflowX: "auto" }}
    >
      {buckets.map((bucket) => {
        const height = Math.max(3, (bucket.total / max) * 160);
        const isAnchor = bucket.month === anchorMonth;
        return (
          <button
            key={bucket.month}
            type="button"
            onClick={() => onMonth(bucket.month)}
            aria-label={`${monthLabel(bucket.month)}, ${inr(bucket.total)}, ${bucket.transaction_count} transactions. View transactions.`}
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", minWidth: 34 }}
          >
            <span className="muted num" style={{ display: "block", fontSize: 10, marginBottom: 6, whiteSpace: "nowrap" }}>
              {inr(bucket.total)}
            </span>
            <span
              style={{
                display: "block",
                height,
                minHeight: 3,
                borderRadius: "6px 6px 2px 2px",
                background: isAnchor ? "var(--accent)" : "var(--accent-soft)",
                border: isAnchor ? "none" : "1px solid color-mix(in oklch, var(--accent) 35%, transparent)",
              }}
            />
            <span style={{ display: "block", fontSize: 11, fontWeight: isAnchor ? 750 : 600, marginTop: 8, color: isAnchor ? "var(--ink)" : "var(--ink-3)" }}>
              {monthLabel(bucket.month).split(" ")[0].slice(0, 3)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CategoryGroupComparisonPage({ month }: { month: string }) {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTo = searchParams.get("to");
  const to = isMonthKey(rawTo) ? rawTo : month;
  const range = normalizeComparisonRange(searchParams.get("range"));

  useEffect(() => {
    if (rawTo === to && searchParams.get("range") === String(range)) return;
    setSearchParams({ to, range: String(range) }, { replace: true });
  }, [range, rawTo, searchParams, setSearchParams, to]);

  const groupsQuery = useQuery({ queryKey: ["categories", "groups"], queryFn: getCategoryGroups });
  const historyQuery = useQuery({
    queryKey: groupSpendHistoryKeys.detail(groupId ?? "", to, range),
    queryFn: ({ signal }) => getGroupSpendHistory({ to, months: range, groupIds: [groupId!], signal }),
    enabled: Boolean(groupId),
    retry: false,
  });

  const group = historyQuery.data?.groups[0];
  const anchor = group?.buckets[group.buckets.length - 1];
  const previous = group?.buckets[group.buckets.length - 2];
  const average = periodAverage(group?.buckets ?? []);
  const share = anchor ? monthlyCostShare(anchor, historyQuery.data?.monthly_costs ?? []) : null;
  const knownGroup = groupsQuery.data?.find((item) => item.id === groupId);

  function setRange(next: ComparisonRange) {
    setSearchParams({ to, range: String(next) });
  }

  function switchGroup(nextGroupId: string) {
    navigate(`/dashboard/groups/${nextGroupId}/compare?to=${to}&range=${range}`, { replace: true });
  }

  function openTransactions(targetMonth: string) {
    navigate(`/dashboard/groups/${groupId}?month=${targetMonth}`);
  }

  return (
    <div className="content fade-in">
      <button className="btn btn-soft" style={{ padding: "6px 12px", marginBottom: 16 }} onClick={() => navigate("/dashboard#category-groups")}>
        <IconChevL size={15} /> Dashboard
      </button>

      <div className="page-head">
        <div>
          <h1 className="page-title">Compare over time</h1>
          <p className="page-sub">Category group history ending {monthLabel(to)}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--ink-2)" }}>
            Category group
            <select
              className="input"
              aria-label="Category group"
              value={knownGroup?.id ?? ""}
              disabled={groupsQuery.isLoading || !(groupsQuery.data?.length)}
              onChange={(event) => switchGroup(event.target.value)}
              style={{ minWidth: 210 }}
            >
              {!knownGroup && <option value="">Select a group</option>}
              {(groupsQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {groupId && (
            <button type="button" className="btn btn-soft" onClick={() => openTransactions(to)}>
              Transactions
            </button>
          )}
        </div>
      </div>

      {groupsQuery.isSuccess && groupsQuery.data.length === 0 ? (
        <div className="card card-pad"><p className="muted" style={{ margin: 0 }}>Create a category group before comparing spending.</p></div>
      ) : historyQuery.isLoading ? (
        <div className="card card-pad" aria-busy="true"><p className="muted" style={{ margin: 0 }}>Loading comparison…</p></div>
      ) : historyQuery.isError || !group ? (
        <div className="card card-pad">
          <p style={{ color: "var(--neg)", marginTop: 0 }}>{knownGroup ? "Could not load this comparison." : "Category group not found."}</p>
          {knownGroup && <button className="btn btn-soft" onClick={() => historyQuery.refetch()}>Retry</button>}
        </div>
      ) : anchor && previous ? (
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="card card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
              <div>
                <div className="stat-lbl">{monthLabel(anchor.month)}</div>
                <div className="num" style={{ fontSize: 34, fontWeight: 800, marginTop: 5 }}>{inr(anchor.total)}</div>
                <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{comparisonText(anchor, previous)}</div>
              </div>
              <div className="seg" aria-label="Comparison range">
                {([3, 6, 12] as ComparisonRange[]).map((value) => (
                  <button key={value} className={range === value ? "on" : ""} onClick={() => setRange(value)}>{value} months</button>
                ))}
              </div>
            </div>
            <HistoryBars buckets={group.buckets} anchorMonth={to} onMonth={openTransactions} />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <Metric label="Transactions" value={String(anchor.transaction_count)} />
            <Metric label="Average transaction" value={anchor.average_transaction == null ? "—" : inr(anchor.average_transaction)} />
            <Metric label="Largest transaction" value={anchor.largest_transaction == null ? "—" : inr(anchor.largest_transaction)} />
            <Metric label={`${range}-month average`} value={inr(average)} />
            <Metric label="Share of monthly cost" value={share == null ? "Unavailable" : pct(share)} />
          </div>

          <ContributionTable
            key={`${group.group_id}:${anchor.month}`}
            groupName={group.group_name}
            month={anchor.month}
            categories={anchor.categories}
            groupTotal={anchor.total}
          />

          <section className="card group-mapping-card" aria-labelledby="group-mapping-title">
            <div className="group-mapping-identity">
              <span className="group-mapping-icon" aria-hidden="true">
                <IconCategories size={23} />
              </span>
              <h2 id="group-mapping-title" className="group-mapping-name">{group.group_name}</h2>
              <p className="group-mapping-note">Historical results use the categories currently included in this group.</p>
            </div>
            <div className="group-mapping-content">
              <div className="group-mapping-heading">
                <span className="group-mapping-heading-icon" aria-hidden="true"><IconCategories size={18} /></span>
                <span>Included categories</span>
                <span className="group-mapping-count" aria-label={`${group.mappings.length} included categories`}>{group.mappings.length}</span>
              </div>
              {group.mappings.length === 0 ? (
                <p className="muted group-mapping-empty">No categories are currently included in this group.</p>
              ) : (
                <div className="group-mapping-list">
                  {group.mappings.map((mapping) => (
                    <span key={mapping.id} className="group-mapping-chip">
                      <i aria-hidden="true" />{mapping.category}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
