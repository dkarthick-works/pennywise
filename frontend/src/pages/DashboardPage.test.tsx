import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "./DashboardPage";
import type { CreditUsageSummary } from "../types";

const mocks = {
  getCreditUsage: vi.fn(),
  getDashboardMonthly: vi.fn(),
  getGroupSpend: vi.fn(),
  getTxnsByMonth: vi.fn(),
  getTxnsByYear: vi.fn(),
  getSettings: vi.fn(),
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
  const heading = await screen.findByText("CC Usage");
  return heading.closest(".card") as HTMLElement;
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getDashboardMonthly.mockResolvedValue({
    month: "2026-07", income: 0, cash_flow: 0, monthly_cost: 0, net_saved: 0,
    savings_rate: 0, monthly_difference: 0, outstanding_credits_count: 0, outstanding_credits_total: 0,
  });
  mocks.getGroupSpend.mockResolvedValue([]);
  mocks.getTxnsByMonth.mockResolvedValue([]);
  mocks.getTxnsByYear.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({
    budgets: { essential: 0, flexible: 0, daily: 0 },
    currency: "INR", theme: "light", templates: { essential: [], flexible: [] },
    credit_statement_day: 15,
    credit_spending_threshold: null,
  });
});

function settingsWithThreshold(threshold: number | null) {
  return {
    budgets: { essential: 0, flexible: 0, daily: 0 },
    currency: "INR", theme: "light", templates: { essential: [], flexible: [] },
    credit_statement_day: 15,
    credit_spending_threshold: threshold,
  };
}

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
