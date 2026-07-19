import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { CreditTransactionsPage } from "./CreditTransactionsPage";
import type { CreditTransactionsResponse } from "../types";

const getCreditTransactions = vi.fn();

vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return {
    ...actual,
    getCreditTransactions: (month: string, view: "calendar" | "billing") =>
      getCreditTransactions(month, view),
  };
});

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/dashboard/credits"
            element={<CreditTransactionsPage month="2026-01" setMonth={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const billingResponse: CreditTransactionsResponse = {
  month: "2026-07",
  view: "billing",
  from: "2026-06-16",
  to: "2026-07-15",
  total: 410,
  count: 2,
  transactions: [
    { id: "a", section: "flexible", category: "Cycle Coffee", amount: 50, date: "2026-06-16", kind: "credit" },
    { id: "b", section: "essential", category: "Cycle Rent", amount: 360, date: "2026-07-15", kind: "credit" },
  ],
};

beforeEach(() => {
  getCreditTransactions.mockReset();
});

describe("CreditTransactionsPage", () => {
  it("honors ?month & ?view from the URL and renders API rows without local filtering", async () => {
    getCreditTransactions.mockResolvedValue(billingResponse);

    renderAt("/dashboard/credits?month=2026-07&view=billing");

    await waitFor(() => expect(getCreditTransactions).toHaveBeenCalledWith("2026-07", "billing"));
    expect(await screen.findByText("Cycle Coffee")).toBeInTheDocument();
    expect(screen.getByText("Cycle Rent")).toBeInTheDocument();
    // Range from the API response is shown in the subheading.
    expect(screen.getByText(/16 Jun – 15 Jul/)).toBeInTheDocument();
  });

  it("defaults to the calendar view when view is missing or invalid", async () => {
    getCreditTransactions.mockResolvedValue({ ...billingResponse, view: "calendar" });

    renderAt("/dashboard/credits?month=2026-07&view=bogus");

    await waitFor(() => expect(getCreditTransactions).toHaveBeenCalledWith("2026-07", "calendar"));
  });

  it("shows a setup CTA (not a generic error) when the billing view 400s", async () => {
    const err = new AxiosError("bad", "400", undefined, undefined, {
      status: 400,
      data: { error: "set a credit statement day to view the billing cycle" },
      statusText: "Bad Request",
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    });
    getCreditTransactions.mockRejectedValue(err);

    renderAt("/dashboard/credits?month=2026-07&view=billing");

    expect(await screen.findByText(/No statement date configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Set statement date/i })).toBeInTheDocument();
  });
});
