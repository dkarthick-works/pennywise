import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import type { CreditUsageSummary } from "../types";

const mocks = {
  getCreditUsage: vi.fn(),
  getDashboardMonthly: vi.fn(),
  getGroupSpend: vi.fn(),
  getTxnsByMonth: vi.fn(),
  getTxnsByYear: vi.fn(),
  getSettings: vi.fn(),
  getMonthlyBudget: vi.fn(),
};

vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return {
    ...actual,
    getCreditUsage: (m: string) => mocks.getCreditUsage(m),
    getDashboardMonthly: (m: string) => mocks.getDashboardMonthly(m),
    getGroupSpend: (m: string) => mocks.getGroupSpend(m),
    getTxnsByMonth: (m: string) => mocks.getTxnsByMonth(m),
    getTxnsByYear: (y: string) => mocks.getTxnsByYear(y),
    getSettings: () => mocks.getSettings(),
    getMonthlyBudget: (m: string) => mocks.getMonthlyBudget(m),
  };
});

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardPage month="2026-07" setMonth={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div>{location.pathname}{location.search}</div>;
}

const configured: CreditUsageSummary = {
  month: "2026-07",
  calendar_month: { from: "2026-07-01", to: "2026-07-31", total: 1500, count: 4 },
  billing_cycle: { statement_day: 15, from: "2026-06-16", to: "2026-07-15", total: 410, count: 2 },
};

const unconfigured: CreditUsageSummary = {
  month: "2026-07",
  calendar_month: { from: "2026-07-01", to: "2026-07-31", total: 1500, count: 4 },
  billing_cycle: null,
};

// Scope assertions to the Credit Card Usage card — the dashboard renders other
// ₹ amounts (e.g. a zeroed monthly-cost card) that must not leak into checks.
async function creditCard(): Promise<HTMLElement> {
  const heading = await screen.findByText("Credit Card Usage");
  return heading.closest(".card") as HTMLElement;
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getDashboardMonthly.mockResolvedValue({
    month: "2026-07", income: 0, cash_spending: 0, remaining_balance: 0, free_money: 0,
    cash_flow: 0, monthly_cost: 0, net_saved: 0,
    savings_rate: 0, monthly_difference: 0, outstanding_credits_count: 0, outstanding_credits_total: 0,
  });
  mocks.getGroupSpend.mockResolvedValue([]);
  mocks.getTxnsByMonth.mockResolvedValue([]);
  mocks.getTxnsByYear.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({
    currency: "INR", theme: "light", templates: { essential: [], flexible: [] },
    credit_statement_day: 15,
    credit_spending_threshold: null,
  });
  mocks.getMonthlyBudget.mockResolvedValue({
    month: "2026-07", essential: 0, flexible: 0, daily: 0,
  });
});

function settingsWithThreshold(threshold: number | null) {
  return {
    currency: "INR", theme: "light", templates: { essential: [], flexible: [] },
    credit_statement_day: 15,
    credit_spending_threshold: threshold,
  };
}

describe("Dashboard cash flow card", () => {
  it("opens the selected month's cash-flow transactions", async () => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard?month=2026-07"]}>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage month="2026-07" setMonth={() => {}} />} />
            <Route path="/dashboard/cash-flow" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "View cash flow transactions for July 2026",
    }));

    expect(await screen.findByText("/dashboard/cash-flow?month=2026-07")).toBeInTheDocument();
  });

  it("omits balance remaining and savings-rate metrics", async () => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    mocks.getDashboardMonthly.mockResolvedValue({
      month: "2026-07", income: 1000, cash_spending: 690, remaining_balance: 310, free_money: 100,
      cash_flow: 690, monthly_cost: 750, net_saved: 310,
      savings_rate: 31, monthly_difference: 60, outstanding_credits_count: 0, outstanding_credits_total: 0,
    });
    renderDashboard();

    const card = within(await screen.findByRole("button", {
      name: "View cash flow transactions for July 2026",
    }));
    expect(card.queryByText("Balance remaining")).not.toBeInTheDocument();
    expect(card.queryByText("Net saved")).not.toBeInTheDocument();
    expect(card.queryByText(/savings rate/i)).not.toBeInTheDocument();
    expect(card.queryByText("31%")).not.toBeInTheDocument();
  });
});

describe("Dashboard credit usage card", () => {
  it("renders both statement-cycle and calendar buckets from the API", async () => {
    mocks.getCreditUsage.mockResolvedValue(configured);
    renderDashboard();

    const card = within(await creditCard());
    expect(await card.findByText("Statement cycle")).toBeInTheDocument();
    expect(card.getByText("Calendar month")).toBeInTheDocument();
    // Amounts come straight from the API.
    expect(card.getByText("₹410")).toBeInTheDocument();
    expect(card.getByText("₹1,500")).toBeInTheDocument();
    // Statement range label.
    expect(card.getByText(/16 Jun – 15 Jul/)).toBeInTheDocument();
  });

  it("shows a setup CTA and no fake zero when the cycle is unconfigured", async () => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();

    const card = within(await creditCard());
    expect(await card.findByText(/Set your statement date to see statement-cycle spend/i)).toBeInTheDocument();
    // Calendar value still shown; statement block must not render a ₹0 total.
    expect(card.getByText("₹1,500")).toBeInTheDocument();
    expect(card.queryByText("₹0")).not.toBeInTheDocument();
  });

  it("does not display a fake total while the summary is loading", async () => {
    let resolve!: (v: CreditUsageSummary) => void;
    mocks.getCreditUsage.mockReturnValue(new Promise<CreditUsageSummary>((r) => { resolve = r; }));
    renderDashboard();

    // Card header is present but no amount yet — a loading skeleton, not ₹0.
    const cardEl = await creditCard();
    const card = within(cardEl);
    expect(cardEl.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(card.queryByText("₹1,500")).not.toBeInTheDocument();
    expect(card.queryByText("₹410")).not.toBeInTheDocument();
    expect(card.queryByText("₹0")).not.toBeInTheDocument();

    resolve(configured);
    await waitFor(() => expect(card.getByText("₹410")).toBeInTheDocument());
  });
});

describe("Dashboard credit spending threshold marker", () => {
  it("shows no marker when the threshold is disabled (null)", async () => {
    mocks.getCreditUsage.mockResolvedValue(configured);
    mocks.getSettings.mockResolvedValue(settingsWithThreshold(null));
    renderDashboard();

    const card = within(await creditCard());
    await card.findByText("Statement cycle");
    expect(card.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(card.queryByText(/ of ₹/)).not.toBeInTheDocument();
    expect(card.queryByText(/left|over/)).not.toBeInTheDocument();
  });

  it("marks the statement cycle within threshold and the calendar month over, for the same threshold", async () => {
    // Statement cycle 410 vs 1000 → within; calendar 1500 vs 1000 → over.
    mocks.getCreditUsage.mockResolvedValue(configured);
    mocks.getSettings.mockResolvedValue(settingsWithThreshold(1000));
    renderDashboard();

    const card = within(await creditCard());
    await card.findByText("Statement cycle");

    await waitFor(() => {
      expect(card.getByText(/₹590 left/)).toBeInTheDocument();
    });
    // Calendar month is over the same threshold by 500.
    expect(card.getByText(/₹500 over/)).toBeInTheDocument();

    const bars = card.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    // Statement cycle: 410/1000 = 41%. Calendar: clamped to 100%.
    expect(bars[0]).toHaveAttribute("aria-valuenow", "41");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "100");
  });

  it("treats exactly-80% spend as within threshold (amber boundary)", async () => {
    // Calendar 1500 / 1875 = exactly 80%.
    mocks.getCreditUsage.mockResolvedValue(configured);
    mocks.getSettings.mockResolvedValue(settingsWithThreshold(1875));
    renderDashboard();

    const card = within(await creditCard());
    await card.findByText("Statement cycle");

    await waitFor(() => expect(card.getByText(/₹375 left/)).toBeInTheDocument());
    expect(card.queryByText(/over/)).not.toBeInTheDocument();
    const bars = card.getAllByRole("progressbar");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "80");
  });

  it("treats exactly-100% spend as within threshold (boundary)", async () => {
    const atLimit: CreditUsageSummary = {
      month: "2026-07",
      calendar_month: { from: "2026-07-01", to: "2026-07-31", total: 1000, count: 3 },
      billing_cycle: { statement_day: 15, from: "2026-06-16", to: "2026-07-15", total: 800, count: 2 },
    };
    mocks.getCreditUsage.mockResolvedValue(atLimit);
    mocks.getSettings.mockResolvedValue(settingsWithThreshold(1000));
    renderDashboard();

    const card = within(await creditCard());
    await card.findByText("Statement cycle");

    // Calendar month is exactly at the threshold → within (₹0 left), not over.
    await waitFor(() => expect(card.getByText(/₹0 left/)).toBeInTheDocument());
    expect(card.queryByText(/over/)).not.toBeInTheDocument();
    const bars = card.getAllByRole("progressbar");
    expect(bars[1]).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("Dashboard daily spend by day", () => {
  beforeEach(() => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function dailyCard(): Promise<HTMLElement> {
    return (await screen.findByTestId("daily-spend-by-day")) as HTMLElement;
  }

  function renderDashboardMonth(month: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <DashboardPage month={month} setMonth={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("shows the card on monthly view with header total matching series", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 7)); // 7 Aug 2026 — July is past

    mocks.getTxnsByMonth.mockResolvedValue([
      { id: "1", section: "daily", category: "Food", amount: 100, date: "2026-07-03", kind: "cash" },
      { id: "2", section: "daily", category: "Cab", amount: 50, date: "2026-07-03", kind: "credit" },
      { id: "3", section: "daily", category: "Pay", amount: 999, date: "2026-07-04", kind: "settlement" },
      { id: "4", section: "essential", category: "Rent", amount: 200, date: "2026-07-05", kind: "cash" },
    ]);
    renderDashboard();

    const cardEl = await dailyCard();
    const card = within(cardEl);
    await waitFor(() => {
      expect(card.getByRole("group", { name: /Daily spend by day for July 2026/ })).toBeInTheDocument();
    });
    expect(card.getByRole("heading", { name: /Daily Spend by Day/ })).toHaveTextContent("Daily Spend by Day");
    // Header total = cash+credit daily only (scoped to this card)
    expect(card.getByText("₹150")).toBeInTheDocument();
    // Past month: avg = 150/31 ≈ ₹5, no "so far"
    expect(card.getByText(/Avg · ₹5\/day/)).toBeInTheDocument();
    expect(card.queryByText(/so far/)).not.toBeInTheDocument();
    expect(card.getByRole("group")).toHaveAccessibleName(
      /total ₹150, average ₹5 per day, 31 days/
    );
    expect(card.getByRole("group").querySelectorAll("g[aria-label]")).toHaveLength(31);
  });

  it("shows so far average for the current month and excludes future spend from avg", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 7)); // 7 Aug 2026

    mocks.getTxnsByMonth.mockResolvedValue([
      { id: "1", section: "daily", category: "Food", amount: 700, date: "2026-08-02", kind: "cash" },
      { id: "2", section: "daily", category: "Trip", amount: 3000, date: "2026-08-20", kind: "cash" },
    ]);
    renderDashboardMonth("2026-08");

    const card = within(await dailyCard());
    await waitFor(() => {
      expect(card.getByRole("group")).toBeInTheDocument();
    });
    // Full-series total includes future-dated txn
    expect(card.getByText("₹3,700")).toBeInTheDocument();
    // Avg numerator through today only: 700/7 = 100
    expect(card.getByText(/Avg · ₹100\/day · so far/)).toBeInTheDocument();
    expect(card.getByRole("group")).toHaveAccessibleName(
      /total ₹3,700, average ₹100 per day so far, 31 days/
    );
  });

  it("hides the card on yearly view", async () => {
    mocks.getTxnsByMonth.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByTestId("daily-spend-by-day")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Yearly/i }));
    await waitFor(() => {
      expect(screen.queryByTestId("daily-spend-by-day")).not.toBeInTheDocument();
    });
  });

  it("shows skeleton while pending — not ₹0", async () => {
    let resolve!: (v: unknown[]) => void;
    mocks.getTxnsByMonth.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderDashboard();

    const cardEl = await dailyCard();
    const card = within(cardEl);
    expect(cardEl.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(card.queryByText("₹0")).not.toBeInTheDocument();
    expect(card.queryByText(/Avg ·/)).not.toBeInTheDocument();
    expect(card.queryByRole("group")).not.toBeInTheDocument();

    resolve([]);
    await waitFor(() => {
      expect(card.queryByRole("group", { name: /Daily spend by day/ })).toBeInTheDocument();
    });
    // Empty successful month may show ₹0 in header — that's fine after success
    expect(card.getByText("₹0")).toBeInTheDocument();
  });

  it("shows error + retry without zero series", async () => {
    mocks.getTxnsByMonth.mockRejectedValue(new Error("network"));
    renderDashboard();

    const card = within(await dailyCard());
    expect(await card.findByText(/Could not load daily spend/i)).toBeInTheDocument();
    expect(card.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    expect(card.queryByRole("group")).not.toBeInTheDocument();
    expect(card.queryByText("₹0")).not.toBeInTheDocument();
    expect(card.queryByText(/Avg ·/)).not.toBeInTheDocument();
  });

  it("highlights today only for the current month", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 15)); // 15 Jul 2026 local

    mocks.getTxnsByMonth.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <DashboardPage month="2026-07" setMonth={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    let card = within(await dailyCard());
    await waitFor(() => expect(card.getByRole("group")).toBeInTheDocument());
    const julyToday = Array.from(card.getByRole("group").querySelectorAll("g[aria-label]")).find((g) =>
      g.getAttribute("aria-label")?.startsWith("15 Jul")
    );
    expect(julyToday?.querySelector("rect[rx]")?.getAttribute("fill")).toBe("var(--c-daily)");
    expect(card.getByText(/so far/)).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <DashboardPage month="2026-06" setMonth={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    card = within(await dailyCard());
    await waitFor(() =>
      expect(card.getByRole("group", { name: /Daily spend by day for June 2026/ })).toBeInTheDocument()
    );
    const bars = card.getByRole("group").querySelectorAll("rect[rx]");
    for (const bar of bars) {
      expect(bar.getAttribute("fill")).toBe("var(--c-daily-soft)");
    }
    expect(card.queryByText(/so far/)).not.toBeInTheDocument();
  });
});

describe("Dashboard section budgets", () => {
  it("uses the selected month's budget on section cards", async () => {
    mocks.getMonthlyBudget.mockResolvedValue({
      month: "2026-07", essential: 30000, flexible: 10000, daily: 15000,
    });
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();

    await waitFor(() => expect(mocks.getMonthlyBudget).toHaveBeenCalledWith("2026-07"));
    expect(await screen.findAllByText(/Budget ·/)).toHaveLength(3);
    expect(screen.getByText("₹30,000")).toBeInTheDocument();
    expect(screen.getByText("₹10,000")).toBeInTheDocument();
    expect(screen.getByText("₹15,000")).toBeInTheDocument();
  });

  it("shows a zero-budget empty bar after a successful all-zero response", async () => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();
    expect(await screen.findAllByText(/Budget ·/)).toHaveLength(3);
    expect(screen.getAllByText("₹0").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading section budgets…")).not.toBeInTheDocument();
  });

  it("does not treat a pending GET as a zero budget", async () => {
    mocks.getMonthlyBudget.mockReturnValue(new Promise(() => {}));
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();
    expect(await screen.findByText("Loading section budgets…")).toBeInTheDocument();
    expect(screen.queryByText("Budget ·")).not.toBeInTheDocument();
  });

  it("shows Retry when the budget GET fails", async () => {
    mocks.getMonthlyBudget.mockRejectedValue(new Error("nope"));
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();
    expect(await screen.findByText("Could not load section budgets.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Budget ·")).not.toBeInTheDocument();
  });

  it("does not fetch monthly budgets after switching to yearly view", async () => {
    mocks.getCreditUsage.mockResolvedValue(unconfigured);
    renderDashboard();
    await waitFor(() => expect(mocks.getMonthlyBudget).toHaveBeenCalledWith("2026-07"));
    mocks.getMonthlyBudget.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Yearly" }));
    await waitFor(() => expect(screen.getByText("Spend per month · 2026")).toBeInTheDocument());
    expect(mocks.getMonthlyBudget).not.toHaveBeenCalled();
  });
});
