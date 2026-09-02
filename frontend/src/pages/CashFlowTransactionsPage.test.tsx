import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CashFlowTransactionsPage } from "./CashFlowTransactionsPage";

const getTxnsByMonth = vi.fn();
const getDashboardMonthly = vi.fn();

vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return {
    ...actual,
    getTxnsByMonth: (month: string) => getTxnsByMonth(month),
    getDashboardMonthly: (month: string) => getDashboardMonthly(month),
  };
});

function renderAt(url: string, setMonth = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/dashboard/cash-flow"
            element={<CashFlowTransactionsPage month="2026-01" setMonth={setMonth} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return setMonth;
}

beforeEach(() => {
  getTxnsByMonth.mockReset();
  getDashboardMonthly.mockReset();
  getDashboardMonthly.mockResolvedValue({
    month: "2026-08", income: 1000, cash_flow: 425, monthly_cost: 825, net_saved: 575,
    savings_rate: 57.5, monthly_difference: 400, outstanding_credits_count: 0, outstanding_credits_total: 0,
  });
});

describe("CashFlowTransactionsPage", () => {
  it("shows only cash and settlement outflows for the month in the URL", async () => {
    getTxnsByMonth.mockResolvedValue([
      { id: "cash", section: "daily", category: "Cash Coffee", amount: 100, date: "2026-08-03", kind: "cash" },
      { id: "settlement", section: "essential", category: "Card Settlement", amount: 250, date: "2026-08-08", kind: "settlement" },
      { id: "flexible", section: "flexible", category: "Music", amount: 75, date: "2026-08-07", kind: "cash" },
      { id: "zero", section: "essential", category: "Unused Subscription", amount: 0, date: "2026-08-01", kind: "cash" },
      { id: "credit", section: "flexible", category: "Credit Shop", amount: 400, date: "2026-08-09", kind: "credit" },
      { id: "income", section: "income", category: "Salary", amount: 1000, date: "2026-08-01", kind: "cash" },
    ]);
    const setMonth = renderAt("/dashboard/cash-flow?month=2026-08");

    await waitFor(() => expect(getTxnsByMonth).toHaveBeenCalledWith("2026-08"));
    expect(getDashboardMonthly).toHaveBeenCalledWith("2026-08");
    expect(setMonth).toHaveBeenCalledWith("2026-08");
    expect(await screen.findByRole("heading", { name: "Cash Flow Transactions" })).toBeInTheDocument();
    expect(screen.getByText("Cash Coffee")).toBeInTheDocument();
    expect(screen.getByText("Card Settlement")).toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.queryByText("Unused Subscription")).not.toBeInTheDocument();
    expect(screen.queryByText("Credit Shop")).not.toBeInTheDocument();
    expect(screen.queryByText("Salary")).not.toBeInTheDocument();
    expect(screen.getByText("₹425")).toBeInTheDocument();
    expect(screen.getByText("Balance remaining")).toBeInTheDocument();
    expect(screen.getByText("+₹575")).toBeInTheDocument();

    const sectionHeadings = screen.getAllByRole("heading", { level: 2 });
    expect(sectionHeadings.map((heading) => heading.textContent)).toEqual([
      "Essential",
      "Flexible",
      "Daily",
    ]);
    expect(within(sectionHeadings[0].closest("section")!).getByLabelText("Essential subtotal")).toHaveTextContent("₹250");
    expect(within(sectionHeadings[1].closest("section")!).getByLabelText("Flexible subtotal")).toHaveTextContent("₹75");
    expect(within(sectionHeadings[2].closest("section")!).getByLabelText("Daily subtotal")).toHaveTextContent("₹100");

    const essentialToggle = screen.getByRole("button", { name: "Collapse Essential section" });
    expect(essentialToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(essentialToggle);
    expect(essentialToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Card Settlement")).not.toBeInTheDocument();
    expect(screen.getByText("Music")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Essential section" }));
    expect(screen.getByText("Card Settlement")).toBeInTheDocument();
  });
});
