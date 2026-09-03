import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { RecordPage } from "./RecordPage";
import type { MonthlyBudget, OpenMonthResponse, Settings } from "../types";

const mocks = {
  openMonth: vi.fn(),
  getSettings: vi.fn(),
  getMonthlyBudget: vi.fn(),
  putMonthlyBudget: vi.fn(),
};

vi.mock("../api/ledger", async () => {
  const actual = await vi.importActual<typeof import("../api/ledger")>("../api/ledger");
  return {
    ...actual,
    openMonth: (month: string) => mocks.openMonth(month),
    getSettings: () => mocks.getSettings(),
    getMonthlyBudget: (month: string) => mocks.getMonthlyBudget(month),
    putMonthlyBudget: (month: string, budgets: unknown) => mocks.putMonthlyBudget(month, budgets),
  };
});

function openMonthPayload(): OpenMonthResponse {
  return { month: "2026-08", closed: false, seeded: true, transactions: [] };
}

function settings(): Settings {
  return {
    currency: "INR",
    theme: "light",
    templates: { essential: [], flexible: [] },
    credit_statement_day: null,
    credit_spending_threshold: null,
  };
}

function monthlyBudget(month: string, extra: Partial<MonthlyBudget> = {}): MonthlyBudget {
  return { month, essential: 10000, flexible: 5000, daily: 15000, ...extra };
}

function DashboardStub() {
  const [searchParams] = useSearchParams();
  return <div>Dashboard page {searchParams.get("month")}</div>;
}

function renderRecord(month = "2026-08") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const setMonth = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/record"]}>
        <Routes>
          <Route
            path="/record"
            element={<RecordPage month={month} setMonth={setMonth} />}
          />
          <Route path="/dashboard" element={<DashboardStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { qc, setMonth, ...utils };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.openMonth.mockResolvedValue(openMonthPayload());
  mocks.getSettings.mockResolvedValue(settings());
  mocks.getMonthlyBudget.mockResolvedValue(monthlyBudget("2026-08"));
  mocks.putMonthlyBudget.mockImplementation((month: string, budgets: { essential: number; flexible: number; daily: number }) =>
    Promise.resolve({ month, essential: budgets.essential, flexible: budgets.flexible, daily: budgets.daily })
  );
});

describe("RecordPage overview", () => {
  it("shows Daily / Running before Bare Minimum", async () => {
    renderRecord();
    const daily = await screen.findByText("Daily / Running");
    const essential = screen.getByText("Bare Minimum");
    expect(daily.compareDocumentPosition(essential)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("navigates to the dashboard for the open month", async () => {
    renderRecord();
    expect(await screen.findByRole("heading", { name: /Record Expense/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to dashboard/i }));
    expect(screen.getByText("Dashboard page 2026-08")).toBeInTheDocument();
  });

  it("loads the shell month budget", async () => {
    renderRecord();
    await waitFor(() => expect(mocks.getMonthlyBudget).toHaveBeenCalledWith("2026-08"));
    expect(await screen.findByText(/of ₹15,000/)).toBeInTheDocument();
  });

  it("does not enable budget inputs until GET succeeds", async () => {
    mocks.getMonthlyBudget.mockReturnValue(new Promise(() => {}));
    renderRecord();
    fireEvent.click(await screen.findByText("Daily / Running"));
    expect(await screen.findByText("Loading budget…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Daily / Running section budget")).not.toBeInTheDocument();
  });
});

describe("RecordPage budget editor", () => {
  async function openDaily() {
    renderRecord();
    fireEvent.click(await screen.findByText("Daily / Running"));
    return screen.findByLabelText("Daily / Running section budget") as Promise<HTMLInputElement>;
  }

  it("saves all three fields on blur", async () => {
    const input = await openDaily();
    fireEvent.change(input, { target: { value: "16000.25" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(mocks.putMonthlyBudget).toHaveBeenCalledWith("2026-08", {
        essential: 10000,
        flexible: 5000,
        daily: 16000.25,
      })
    );
  });

  it("saves on Enter and does not PUT twice on the following blur", async () => {
    const input = await openDaily();
    fireEvent.change(input, { target: { value: "16000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await waitFor(() => expect(mocks.putMonthlyBudget).toHaveBeenCalledTimes(1));
  });

  it("keeps the draft after a failed PUT and allows retry", async () => {
    mocks.putMonthlyBudget.mockRejectedValueOnce(new Error("nope"));
    const input = await openDaily();
    fireEvent.change(input, { target: { value: "16000" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Couldn’t save budget/)).toBeInTheDocument();
    expect(input.value).toBe("16,000");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.putMonthlyBudget).toHaveBeenCalledTimes(2));
  });

  it("invalidates the dashboard monthly query for the saved month", async () => {
    const { qc } = renderRecord();
    qc.setQueryData(["dashboard", "monthly", "2026-08"], { month: "2026-08" });
    fireEvent.click(await screen.findByText("Daily / Running"));
    const input = await screen.findByLabelText("Daily / Running section budget");
    fireEvent.change(input, { target: { value: "16000" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(qc.getQueryState(["dashboard", "monthly", "2026-08"])?.isInvalidated).toBe(true)
    );
  });
});
