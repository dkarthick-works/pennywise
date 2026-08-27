import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CategoryGroupComparisonPage } from "./CategoryGroupComparisonPage";
import type { GroupSpendHistoryResponse } from "../types";

const mocks = {
  getCategoryGroups: vi.fn(),
  getGroupSpendHistory: vi.fn(),
};

vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return {
    ...actual,
    getCategoryGroups: () => mocks.getCategoryGroups(),
    getGroupSpendHistory: (params: unknown) => mocks.getGroupSpendHistory(params),
  };
});

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function history(months = 6): GroupSpendHistoryResponse {
  const keys = months === 3
    ? ["2026-06", "2026-07", "2026-08"]
    : ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  return {
    from: keys[0], to: "2026-08", months,
    monthly_costs: keys.map((month) => ({ month, total: month === "2026-08" ? 1000 : 500 })),
    groups: [{
      group_id: "food", group_name: "Online Food",
      mappings: [{ id: "m1", category: "Swiggy" }, { id: "m2", category: "Zomato" }],
      buckets: keys.map((month, index) => ({
        month,
        total: month === "2026-08" ? 600 : index === keys.length - 2 ? 400 : 0,
        transaction_count: month === "2026-08" ? 3 : index === keys.length - 2 ? 2 : 0,
        average_transaction: month === "2026-08" ? 200 : null,
        median_transaction: month === "2026-08" ? 180 : null,
        largest_transaction: month === "2026-08" ? 300 : null,
        categories: month === "2026-08" ? [
          { category: "Swiggy", total: 400, transaction_count: 2 },
          { category: "Zomato", total: 200, transaction_count: 1 },
        ] : [],
      })),
    }],
  };
}

function renderPage(entry = "/dashboard/groups/food/compare?to=2026-08&range=6") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Location />
        <Routes>
          <Route path="/dashboard/groups/:groupId/compare" element={<CategoryGroupComparisonPage month="2026-08" />} />
          <Route path="*" element={<div>Transaction detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.getCategoryGroups.mockReset();
  mocks.getGroupSpendHistory.mockReset();
  mocks.getCategoryGroups.mockResolvedValue([
    { id: "food", name: "Online Food", mappings: [] },
    { id: "rent", name: "Rent", mappings: [] },
  ]);
  mocks.getGroupSpendHistory.mockImplementation(({ months }: { months: number }) => Promise.resolve(history(months)));
});

describe("CategoryGroupComparisonPage", () => {
  it("renders the range average, metrics, mappings, and contribution breakdown", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Online Food" })).toBeInTheDocument();
    expect(screen.getByText("Included categories")).toBeInTheDocument();
    expect(screen.getByLabelText("2 included categories")).toBeInTheDocument();
    expect(screen.getByText("6-month average")).toBeInTheDocument();
    expect(screen.getByText("₹167")).toBeInTheDocument();
    expect(screen.getByText("Up ₹200 · 50% from July 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Swiggy")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Amount" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "% of total" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sort category spending")).toHaveValue("amount-desc");
    expect(screen.getByText("60%")).toBeInTheDocument();

    const mappingSection = screen.getByText("Included categories").closest("section");
    const rangeAverage = screen.getByText("6-month average");
    const contributionHeader = screen.getByRole("columnheader", { name: "% of total" });
    expect(mappingSection).not.toBeNull();
    expect(rangeAverage.compareDocumentPosition(mappingSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(contributionHeader.compareDocumentPosition(mappingSection!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(mocks.getGroupSpendHistory).toHaveBeenCalledWith(expect.objectContaining({ to: "2026-08", months: 6, groupIds: ["food"] }));
  });

  it("requests exactly the selected range and switches groups without returning to dashboard", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Online Food" });

    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    await waitFor(() => expect(mocks.getGroupSpendHistory).toHaveBeenCalledWith(expect.objectContaining({ months: 3 })));

    fireEvent.change(screen.getByLabelText("Category group"), { target: { value: "rent" } });
    expect(await screen.findByTestId("location")).toHaveTextContent("/dashboard/groups/rent/compare?to=2026-08&range=3");
  });

  it("opens an older chart month directly in transaction detail", async () => {
    renderPage();
    const march = await screen.findByRole("button", { name: /March 2026.*View transactions/i });
    fireEvent.click(march);
    expect(await screen.findByTestId("location")).toHaveTextContent("/dashboard/groups/food?month=2026-03");
  });
});
