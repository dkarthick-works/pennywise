import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChitsPage } from "./ChitsPage";
import type { ChitSummary } from "../types";

const mocks = {
  listChits: vi.fn(),
};

vi.mock("../api/chits", () => ({
  listChits: () => mocks.listChits(),
}));

function sampleChit(overrides: Partial<ChitSummary> = {}): ChitSummary {
  return {
    id: "c1",
    name: "Office Chit A",
    organizer: "Ramesh",
    chit_value: 100000,
    expected_monthly: 5000,
    total_installments: 20,
    start_month: "2026-07-01",
    installment_count: 2,
    total_paid: 9800,
    status: "active",
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/chits"]}>
          <Routes>
            <Route path="/chits" element={<ChitsPage />} />
            <Route path="/chits/new" element={<div>Create page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mocks.listChits.mockReset();
});

describe("ChitsPage", () => {
  it("shows loading then empty state", async () => {
    let resolveList!: (v: ChitSummary[]) => void;
    mocks.listChits.mockReturnValue(new Promise((r) => { resolveList = r; }));
    renderPage();
    expect(screen.getByText(/Loading chits/i)).toBeInTheDocument();
    resolveList([]);
    expect(await screen.findByText(/No chits yet/i)).toBeInTheDocument();
  });

  it("shows error state", async () => {
    mocks.listChits.mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByText(/Could not load chits/i)).toBeInTheDocument();
  });

  it("lists progress and status without an inline create form", async () => {
    mocks.listChits.mockResolvedValue([sampleChit()]);
    renderPage();
    expect(await screen.findByText("Office Chit A")).toBeInTheDocument();
    expect(screen.getByText("2 / 20")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/tracked separately from expenses/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Start month/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save chit/i })).not.toBeInTheDocument();
  });

  it("navigates to create page via Add chit", async () => {
    mocks.listChits.mockResolvedValue([]);
    renderPage();
    await screen.findByText(/No chits yet/i);
    fireEvent.click(screen.getByRole("button", { name: /Add a chit|Add chit/i }));
    expect(await screen.findByText("Create page")).toBeInTheDocument();
  });
});
