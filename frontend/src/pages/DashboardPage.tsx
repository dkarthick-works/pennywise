import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { getDashboardMonthly, getGroupSpend, getTxnsByMonth, getTxnsByYear, getSettings } from "../api/ledger";
import { sectionSums, creditExpenseTransactions } from "../lib/txns";
import { inr, inrShort, budgetColor } from "../lib/money";
import { monthLabel, shiftMonth, MONTH_NAMES } from "../lib/dates";
import { Donut, YearBars } from "../components/charts/Charts";
import { IconChevL, IconChevR, IconWallet, IconTrend, IconCreditCard } from "../components/ui/Icons";

const SECMETA = {
  essential: { label: "Essential", color: "var(--c-essential)" },
  flexible:  { label: "Flexible",  color: "var(--c-flexible)" },
  daily:     { label: "Daily",     color: "var(--c-daily)" },
};

function MonthSelector({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  return (
    <div className="msel">
      <button className="arw" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
        <IconChevL size={17} />
      </button>
      <span className="lbl">{monthLabel(month)}</span>
      <button className="arw" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
        <IconChevR size={17} />
      </button>
    </div>
  );
}

function HeroRow({ label, value, strong, color }: {
  label: string; value: string; strong?: boolean; color?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0" }}>
      <span className="stat-lbl" style={{ color: strong ? "var(--ink)" : "var(--ink-2)", fontWeight: strong ? 650 : 500 }}>{label}</span>
      <span
        className="num"
        style={{ fontWeight: strong ? 700 : 600, fontSize: strong ? 15 : 14.5, color: color ?? "var(--ink)" }}
      >
        {value}
      </span>
    </div>
  );
}

export function DashboardPage({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<"monthly" | "yearly">("monthly");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(null);
  const year = month.slice(0, 4);

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const { data: monthTxns = [] } = useQuery({
    queryKey: ["txns", "month", month],
    queryFn: () => getTxnsByMonth(month),
    enabled: view === "monthly",
  });

  const { data: dashboardMonthly } = useQuery({
    queryKey: ["dashboard", "monthly", month],
    queryFn: () => getDashboardMonthly(month),
    enabled: view === "monthly",
  });

  const { data: groupSpend = [] } = useQuery({
    queryKey: ["group-spend", month],
    queryFn: () => getGroupSpend(month),
    enabled: view === "monthly",
  });

  const { data: yearTxns = [] } = useQuery({
    queryKey: ["txns", "year", year],
    queryFn: () => getTxnsByYear(year),
    enabled: view === "yearly",
  });

  useEffect(() => {
    setSelectedGroupIds((prev) => {
      if (groupSpend.length === 0) return null;
      const allIds = groupSpend.map((g) => g.group_id);
      if (prev === null) return allIds;
      const validIds = new Set(allIds);
      return prev.filter((id) => validIds.has(id));
    });
  }, [groupSpend]);

  useEffect(() => {
    if (location.hash !== "#category-groups" || groupSpend.length === 0) return;
    document.getElementById("category-groups")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, groupSpend.length]);

  const budgets = settings?.budgets ?? { essential: 0, flexible: 0, daily: 0 };

  // ---- monthly computations ----
  const incBy  = sectionSums(monthTxns, month, "incurred");
  const spentIncurred = incBy.essential + incBy.flexible + incBy.daily;

  const sectionCards = (["essential", "flexible", "daily"] as const).map((k) => {
    const spent  = incBy[k];
    const budget = budgets[k] ?? 0;
    const ratio  = budget ? spent / budget : 0;
    const pctOfTotal = spentIncurred ? (spent / spentIncurred) * 100 : 0;
    return { k, ...SECMETA[k], spent, budget, ratio, pctOfTotal };
  });

  // ---- yearly computations ----
  const perMonth = MONTH_NAMES.map((nm, i) => {
    const mk = `${year}-${String(i + 1).padStart(2, "0")}`;
    const sums = sectionSums(yearTxns, mk, "incurred");
    const total = sums.essential + sums.flexible + sums.daily;
    return { key: mk, label: nm.slice(0, 3), value: total, sums };
  });
  const activeMonths = perMonth.filter((m) => m.value > 0);
  const totalSpend  = perMonth.reduce((s, m) => s + m.value, 0);
  const totalIncome = yearTxns
    .filter((t) => t.section === "income" && t.date.slice(0, 4) === year)
    .reduce((s, t) => s + t.amount, 0);
  const avg = activeMonths.length ? totalSpend / activeMonths.length : 0;
  const biggest = perMonth.reduce((a, b) => (b.value > a.value ? b : a), perMonth[0]);

  const catMap: Record<string, number> = {};
  yearTxns.forEach((t) => {
    if (t.date.slice(0, 4) === year && t.kind !== "settlement")
      catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });
  const topCats = Object.entries(catMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 7);
  const maxCat = topCats[0]?.amount || 1;

  const yearSplit = perMonth.reduce(
    (a, m) => ({ essential: a.essential + m.sums.essential, flexible: a.flexible + m.sums.flexible, daily: a.daily + m.sums.daily }),
    { essential: 0, flexible: 0, daily: 0 }
  );

  const income = dashboardMonthly?.income ?? 0;
  const cashFlow = dashboardMonthly?.cash_flow ?? 0;
  const monthlyCost = dashboardMonthly?.monthly_cost ?? 0;
  const netSaved = dashboardMonthly?.net_saved ?? 0;
  const savingsRate = dashboardMonthly?.savings_rate ?? 0;
  const monthlyDifference = dashboardMonthly?.monthly_difference ?? 0;
  const creditTxns = creditExpenseTransactions(monthTxns);
  const creditCount = creditTxns.length;
  const creditTotal = creditTxns.reduce((s, t) => s + t.amount, 0);
  const allGroupIds = groupSpend.map((g) => g.group_id);
  const effectiveSelectedGroupIds = selectedGroupIds ?? allGroupIds;
  const selectedGroupIdSet = new Set(effectiveSelectedGroupIds);
  const selectedGroupSpend = groupSpend
    .filter((g) => selectedGroupIdSet.has(g.group_id))
    .sort((a, b) => b.total - a.total || a.group_name.localeCompare(b.group_name));
  const maxGroupSpend = Math.max(0, ...selectedGroupSpend.map((g) => g.total));
  const groupSelectionLabel =
    selectedGroupSpend.length === groupSpend.length
      ? "All groups"
      : `${selectedGroupSpend.length} selected`;
  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev ?? allGroupIds);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return Array.from(next);
    });
  };

  return (
    <div className="content fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            {view === "monthly"
              ? "Where your money went, and when it actually moved."
              : `Your money across ${year}.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            <button className={view === "monthly" ? "on" : ""} onClick={() => setView("monthly")}>Monthly</button>
            <button className={view === "yearly" ? "on" : ""} onClick={() => setView("yearly")}>Yearly</button>
          </div>
          {view === "monthly" ? (
            <MonthSelector month={month} setMonth={setMonth} />
          ) : (
            <div className="msel">
              <button className="arw" onClick={() => setMonth(shiftMonth(month, -12))}><IconChevL size={17} /></button>
              <span className="lbl">{year}</span>
              <button className="arw" onClick={() => setMonth(shiftMonth(month, 12))}><IconChevR size={17} /></button>
            </div>
          )}
        </div>
      </div>

      {view === "monthly" ? (
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          {/* hero cards */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                <h3 className="card-h" style={{ whiteSpace: "nowrap" }}>
                  <IconTrend size={16} style={{ color: "var(--c-flexible)" }} /> Monthly Cost
                </h3>
                <span className="chip" style={{ background: "oklch(0.95 0.03 265)", color: "oklch(0.5 0.1 265)", whiteSpace: "nowrap", flex: "none" }}>
                  by transaction date
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>What you incurred — regardless of when paid.</p>
              <div
                style={{
                  margin: "0 0 10px",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-2)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
                  <div>
                    <div className="stat-lbl" style={{ color: "var(--ink)", fontWeight: 700, marginBottom: 3 }}>Spent this month</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>cash + credit</div>
                  </div>
                  <div className="num" style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--ink)" }}>
                    {inr(monthlyCost)}
                  </div>
                </div>
              </div>
              <HeroRow label="Income" value={inr(income)} color="var(--pos)" />
              <div style={{ height: 1, background: "var(--border-2)", margin: "9px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <span className="stat-lbl">Difference</span>
                <span className="stat-big num" style={{ color: monthlyDifference >= 0 ? "var(--pos)" : "var(--neg)" }}>
                  {monthlyDifference >= 0 ? "+" : "−"}{inr(Math.abs(monthlyDifference))}
                </span>
              </div>
            </div>

            <div className="card card-pad">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                <h3 className="card-h" style={{ whiteSpace: "nowrap" }}>
                  <IconWallet size={16} style={{ color: "var(--accent)" }} /> Cash Flow
                </h3>
                <span className="chip" style={{ background: "var(--accent-soft)", color: "var(--accent-ink)", whiteSpace: "nowrap", flex: "none" }}>
                  by payment date
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>Cash that actually moved this month.</p>
              <div
                style={{
                  margin: "0 0 10px",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-2)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
                  <div>
                    <div className="stat-lbl" style={{ color: "var(--ink)", fontWeight: 700, marginBottom: 3 }}>Cash out</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>cash + settlements</div>
                  </div>
                  <div className="num" style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--ink)" }}>
                    {inr(cashFlow)}
                  </div>
                </div>
              </div>
              <HeroRow label="Income"     value={inr(income)}  color="var(--pos)" />
              <div style={{ height: 1, background: "var(--border-2)", margin: "10px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <span className="stat-lbl">Net saved</span>
                <span className="stat-big num" style={{ color: netSaved >= 0 ? "var(--pos)" : "var(--neg)" }}>
                  {netSaved >= 0 ? "+" : "−"}{inr(Math.abs(netSaved))}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                <span className="num" style={{ fontWeight: 600 }}>{Math.round(savingsRate)}%</span> savings rate
              </div>
            </div>

            <div
              role="button"
              tabIndex={0}
              className="card card-pad hero-card-link"
              onClick={() => navigate("/dashboard/credits")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate("/dashboard/credits");
                }
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
                <h3 className="card-h" style={{ whiteSpace: "nowrap" }}>
                  <IconCreditCard size={16} style={{ color: "var(--c-daily)" }} /> Credit Card Usage
                </h3>
                <span className="chip" style={{ background: "oklch(0.95 0.03 265)", color: "oklch(0.5 0.1 265)", whiteSpace: "nowrap", flex: "none" }}>
                  by transaction date
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>What you charged to credit this month.</p>
              <div
                style={{
                  margin: "0 0 10px",
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border-2)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
                  <div>
                    <div className="stat-lbl" style={{ color: "var(--ink)", fontWeight: 700, marginBottom: 3 }}>Credit spent</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>credit transactions</div>
                  </div>
                  <div className="num" style={{ fontSize: 29, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--ink)" }}>
                    {inr(creditTotal)}
                  </div>
                </div>
              </div>
              <HeroRow label="Transactions" value={String(creditCount)} />
              <div
                className="muted"
                style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
              >
                View all credit transactions
                <IconChevR size={14} style={{ color: "var(--ink-3)", flex: "none" }} />
              </div>
            </div>
          </div>

          {/* section cards */}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {sectionCards.map((s) => (
              <div key={s.k} className="card card-pad">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
                    <span className="dot" style={{ background: s.color }} />{s.label}
                  </span>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", flex: "none" }}>
                    {Math.round(s.pctOfTotal)}% of spend
                  </span>
                </div>
                <div className="num" style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 14 }}>
                  {inr(s.spent)}
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.min(s.ratio * 100, 100)}%`, background: budgetColor(s.ratio) }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 9, fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: budgetColor(s.ratio), whiteSpace: "nowrap" }}>
                    {Math.round(s.ratio * 100)}% used
                  </span>
                  <span className="muted num" style={{ whiteSpace: "nowrap" }}>
                    {inr(Math.max(s.budget - s.spent, 0))} left
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-2)" }}>
                  Budget · <span className="num">{inr(s.budget)}</span>
                </div>
              </div>
            ))}
          </div>

          {groupSpend.length > 0 && (
            <div id="category-groups" className="card card-pad">
              <div>
                <h3 className="card-h" style={{ margin: 0 }}>Category Groups</h3>
                <span className="muted" style={{ display: "block", fontSize: 12.5, marginTop: 4 }}>
                  Custom group spend for {monthLabel(month)}
                </span>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  <details style={{ position: "relative" }}>
                    <summary
                      className="btn btn-soft"
                      style={{ listStyle: "none", cursor: "pointer", minWidth: 170, justifyContent: "space-between" }}
                    >
                      {groupSelectionLabel}
                      <IconChevR size={14} style={{ transform: "rotate(90deg)" }} />
                    </summary>
                    <div
                      className="card"
                      style={{
                        position: "absolute",
                        zIndex: 5,
                        top: "calc(100% + 8px)",
                        left: 0,
                        width: 260,
                        padding: 10,
                        boxShadow: "var(--shadow)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <button className="btn btn-soft" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setSelectedGroupIds(allGroupIds)}>
                          All
                        </button>
                        <button className="btn btn-soft" style={{ padding: "5px 9px", fontSize: 12 }} onClick={() => setSelectedGroupIds([])}>
                          Clear
                        </button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 240, overflow: "auto" }}>
                        {groupSpend.map((g) => (
                          <label key={g.group_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
                            <input
                              type="checkbox"
                              checked={selectedGroupIdSet.has(g.group_id)}
                              onChange={() => toggleGroup(g.group_id)}
                            />
                            <span style={{ flex: 1 }}>{g.group_name}</span>
                            <span className="muted num" style={{ fontSize: 12 }}>{inr(g.total)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </details>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Groups can overlap when the same category text is mapped more than once.
                  </span>
                </div>

                {selectedGroupSpend.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    Select at least one group to see spend cards.
                  </p>
                ) : (
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                    {selectedGroupSpend.map((g) => (
                      <button
                        key={g.group_id}
                        type="button"
                        className="group-card-link"
                        onClick={() => navigate(`/dashboard/groups/${g.group_id}`)}
                        aria-label={`View ${g.group_name} transactions`}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
                          <span style={{ fontWeight: 650, fontSize: 14 }}>{g.group_name}</span>
                          <IconChevR size={14} style={{ color: "var(--ink-3)" }} />
                        </div>
                        <div className="num" style={{ fontSize: 24, fontWeight: 750, letterSpacing: "-0.02em", marginBottom: 13 }}>
                          {inr(g.total)}
                        </div>
                        <div className="bar">
                          <i style={{ width: `${maxGroupSpend ? (g.total / maxGroupSpend) * 100 : 0}%`, background: "var(--accent)" }} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ---- yearly view ---- */
        <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {([
              { l: "Total income",   v: inr(totalIncome), c: "var(--pos)" },
              { l: "Total spent",    v: inr(totalSpend),  c: "var(--ink)" },
              { l: "Avg / month",    v: inr(avg),         c: "var(--ink)" },
              { l: "Biggest month",  v: biggest.label + " · " + inrShort(biggest.value), c: "var(--ink)", small: true },
            ] as { l: string; v: string; c: string; small?: boolean }[]).map((s, i) => (
              <div key={i} className="card card-pad">
                <div className="stat-lbl" style={{ marginBottom: 6 }}>{s.l}</div>
                <div className="num" style={{ fontSize: s.small ? 22 : 27, fontWeight: 700, letterSpacing: "-0.02em", color: s.c }}>
                  {s.v}
                </div>
              </div>
            ))}
          </div>

          <div className="card card-pad">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 className="card-h">Spend per month · {year}</h3>
              <div style={{ display: "flex", gap: 16, fontSize: 12.5 }} className="muted">
                Income this year <b className="num" style={{ color: "var(--pos)" }}>{inr(totalIncome)}</b>
              </div>
            </div>
            <YearBars data={perMonth} highlight={biggest.label} />
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <div className="card card-pad">
              <h3 className="card-h" style={{ marginBottom: 16 }}>Top spend categories</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
                {topCats.map((c, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 5 }}>
                      <span style={{ fontWeight: 500 }}>
                        <span className="muted num" style={{ marginRight: 8 }}>{String(i + 1).padStart(2, "0")}</span>
                        {c.category}
                      </span>
                      <span className="num" style={{ fontWeight: 600 }}>{inr(c.amount)}</span>
                    </div>
                    <div className="bar" style={{ height: 6 }}>
                      <i style={{ width: `${(c.amount / maxCat) * 100}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card card-pad">
              <h3 className="card-h" style={{ marginBottom: 16 }}>Section split · full year</h3>
              <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                <Donut
                  segments={[
                    { label: "Essential", value: yearSplit.essential, color: "var(--c-essential)" },
                    { label: "Flexible",  value: yearSplit.flexible,  color: "var(--c-flexible)" },
                    { label: "Daily",     value: yearSplit.daily,     color: "var(--c-daily)" },
                  ]}
                  centerTop={inrShort(totalSpend)}
                  centerBot="year"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minWidth: 140 }}>
                  {(["Essential","Flexible","Daily"] as const).map((l) => {
                    const key = l.toLowerCase() as "essential" | "flexible" | "daily";
                    return (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span className="dot" style={{ background: `var(--c-${key})`, width: 10, height: 10 }} />
                        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{l}</span>
                        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>{inr(yearSplit[key])}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
