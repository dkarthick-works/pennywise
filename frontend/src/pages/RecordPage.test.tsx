import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { RecordPage } from "./RecordPage";
import type { OpenMonthResponse, Settings } from "../types";

const mocks = {
  openMonth: vi.fn(),
  getSettings: vi.fn(),
};

vi.mock("../api/ledger", async () => {
  const actual = await vi.importActual<typeof import("../api/ledger")>("../api/ledger");
  return {
    ...actual,
    openMonth: (month: string) => mocks.openMonth(month),
    getSettings: () => mocks.getSettings(),
  };
});

function openMonthPayload(): OpenMonthResponse {
  return { month: "2026-08", closed: false, seeded: true, transactions: [] };
}

function settings(): Settings {
  return {
    budgets: { essential: 0, flexible: 0, daily: 0 },
    currency: "INR",
    theme: "light",
    templates: { essential: [], flexible: [] },
    credit_statement_day: null,
    credit_spending_threshold: null,
  };
}

function DashboardStub() {
  const [searchParams] = useSearchParams();
  return <div>Dashboard page {searchParams.get("month")}</div>;
}

function renderRecord(month = "2026-08") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/record"]}>
        <Routes>
          <Route
            path="/record"
            element={<RecordPage month={month} setMonth={vi.fn()} />}
          />
          <Route path="/dashboard" element={<DashboardStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.openMonth.mockReset();
  mocks.getSettings.mockReset();
  mocks.openMonth.mockResolvedValue(openMonthPayload());
  mocks.getSettings.mockResolvedValue(settings());
});

describe("RecordPage dashboard shortcut", () => {
  it("navigates to the dashboard for the open month", async () => {
    renderRecord();
    expect(await screen.findByRole("heading", { name: /Record Expense/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to dashboard/i }));
    expect(screen.getByText("Dashboard page 2026-08")).toBeInTheDocument();
  });
});
