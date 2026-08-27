import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { CategoryGroupPage } from "./CategoryGroupPage";

const getCategoryGroupTransactions = vi.fn();
vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return { ...actual, getCategoryGroupTransactions: (...args: unknown[]) => getCategoryGroupTransactions(...args) };
});

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

beforeEach(() => {
  getCategoryGroupTransactions.mockReset();
  getCategoryGroupTransactions.mockResolvedValue({
    group_id: "food", group_name: "Online Food", month: "2026-06", total: 100, transactions: [],
  });
});

it("uses the URL month and links to comparison with that month", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard/groups/food?month=2026-06"]}>
        <Location />
        <Routes>
          <Route path="/dashboard/groups/:groupId" element={<CategoryGroupPage month="2026-08" />} />
          <Route path="*" element={<div>Comparison</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  expect(await screen.findByText("Transactions for June 2026")).toBeInTheDocument();
  expect(getCategoryGroupTransactions).toHaveBeenCalledWith("food", "2026-06");
  fireEvent.click(screen.getByRole("button", { name: /Compare over time/i }));
  expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/groups/food/compare?to=2026-06&range=6");
});
