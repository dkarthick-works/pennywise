import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { RecordPage } from "./RecordPage";
import type { IncomeActivityItem, MonthlyBudget, OpenMonthResponse, Settings } from "../types";
import { reserveKeys } from "../api/reserves";

const mocks = {
  openMonth: vi.fn(),
  getSettings: vi.fn(),
  getMonthlyBudget: vi.fn(),
  putMonthlyBudget: vi.fn(),
  createTxn: vi.fn(),
  getIncomeActivity: vi.fn(),
  listReserves: vi.fn(),
  createReserveDeposit: vi.fn(),
};

vi.mock("../api/ledger", async () => {
  const actual = await vi.importActual<typeof import("../api/ledger")>("../api/ledger");
  return {
    ...actual,
    openMonth: (month: string) => mocks.openMonth(month),
    getSettings: () => mocks.getSettings(),
    getMonthlyBudget: (month: string) => mocks.getMonthlyBudget(month),
    putMonthlyBudget: (month: string, budgets: unknown) => mocks.putMonthlyBudget(month, budgets),
    createTxn: (body: unknown) => mocks.createTxn(body),
  };
});

vi.mock("../api/reserves", async () => {
  const actual = await vi.importActual<typeof import("../api/reserves")>("../api/reserves");
  return {
    ...actual,
    getIncomeActivity: (month: string, signal?: AbortSignal) => mocks.getIncomeActivity(month, signal),
    listReserves: (includeArchived?: boolean, signal?: AbortSignal) => mocks.listReserves(includeArchived, signal),
    createReserveDeposit: (body: unknown) => mocks.createReserveDeposit(body),
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

function StatefulRecord() {
  const [month, setMonth] = useState("2026-08");
  return <RecordPage month={month} setMonth={setMonth} />;
}

function renderStatefulRecord() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><StatefulRecord /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.openMonth.mockResolvedValue(openMonthPayload());
  mocks.getSettings.mockResolvedValue(settings());
  mocks.getMonthlyBudget.mockResolvedValue(monthlyBudget("2026-08"));
  mocks.putMonthlyBudget.mockImplementation((month: string, budgets: { essential: number; flexible: number; daily: number }) =>
    Promise.resolve({ month, essential: budgets.essential, flexible: budgets.flexible, daily: budgets.daily })
  );
  mocks.getIncomeActivity.mockResolvedValue([]);
  mocks.listReserves.mockResolvedValue([{ id: "general", name: "General Reserve", is_general: true, archived: false, balance: 0 }]);
  mocks.createReserveDeposit.mockResolvedValue({ id: "deposit", operation_type: "deposit", date: "2026-08-18", description: "RSU vest", note: "", total: 60000, entries: [], created_at: "", updated_at: "" });
  mocks.createTxn.mockResolvedValue({ id: "income", section: "income", category: "Freelance", amount: 2000, date: "2026-09-01", kind: "cash" });
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

describe("RecordPage income activity", () => {
  const normalIncome = { id: "salary", section: "income" as const, category: "Salary", amount: 85000, date: "2026-08-10", kind: "cash" as const };
  const generatedIncome = { id: "from-reserve", section: "income" as const, category: "From General Reserve", amount: 5000, date: "2026-08-20", kind: "cash" as const };
  const activity: IncomeActivityItem[] = [
    { source: "normal_transaction", nature: "from_reserve", counts_as_income: true, transaction_id: "from-reserve", reserve_operation_id: "move", description: "From General Reserve", amount: 5000, date: "2026-08-20", reserve_name: "General Reserve", allocations: [], created_at: "2026-08-20T10:00:00Z" },
    { source: "normal_transaction", nature: "normal_income", counts_as_income: true, transaction_id: "salary", reserve_operation_id: null, description: "Salary", amount: 85000, date: "2026-08-10", reserve_name: null, allocations: [], created_at: "2026-08-10T10:00:00Z" },
    { source: "reserve_deposit", nature: "sent_to_reserves", counts_as_income: false, transaction_id: null, reserve_operation_id: "deposit", description: "RSU vest", amount: 60000, date: "2026-08-18", reserve_name: null, allocations: [{ id: "entry", reserve_id: "general", reserve_name: "General Reserve", direction: "deposit", amount: 60000 }], created_at: "2026-08-18T10:00:00Z" },
  ];

  it("separates normal income from sent-to-reserves activity", async () => {
    mocks.openMonth.mockResolvedValue({ ...openMonthPayload(), transactions: [normalIncome, generatedIncome] });
    mocks.getIncomeActivity.mockResolvedValue(activity);
    renderRecord();
    fireEvent.click(await screen.findByText("Income"));

    expect(await screen.findByRole("button", { name: "Normal income" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Send to reserves" })).toBeInTheDocument();
    expect(screen.getByText("Received this month").nextElementSibling).toHaveTextContent("₹90,000");
    expect(await screen.findByText("From General Reserve", { selector: ".chip" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sent to reserves" })).toBeInTheDocument();
    expect(screen.getByText(/not included in normal income or Dashboard calculations/i)).toBeInTheDocument();
    expect(await screen.findByText((_, element) => element?.tagName === "LI" && element.textContent === "General Reserve · ₹60,000")).toBeInTheDocument();
  });

  it("retains normal transaction creation when Normal income is selected", async () => {
    const user = userEvent.setup();
    mocks.openMonth.mockResolvedValue({ ...openMonthPayload(), transactions: [normalIncome] });
    const { qc } = renderRecord();
    qc.setQueryData(reserveKeys.incomeActivity("2026-08"), activity);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(await screen.findByText("Income"));
    await user.type(await screen.findByPlaceholderText("e.g. Salary, Freelance, Dividend"), "Freelance");
    await user.type(screen.getByPlaceholderText("0"), "2000");
    await user.click(screen.getByRole("button", { name: "Add income" }));
    await waitFor(() => expect(mocks.createTxn).toHaveBeenCalledWith({ section: "income", category: "Freelance", amount: 2000, date: "2026-08-10", kind: "cash" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reserveKeys.incomeActivity("2026-08") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reserveKeys.incomeActivity("2026-09") });
  });

  it("sends income directly to reserves without creating a normal transaction", async () => {
    const user = userEvent.setup();
    mocks.openMonth.mockResolvedValue({ ...openMonthPayload(), transactions: [normalIncome] });
    mocks.getIncomeActivity.mockResolvedValue(activity);
    const { qc } = renderRecord();
    qc.setQueryData(reserveKeys.list(false), [{ id: "general", name: "General Reserve", is_general: true, archived: false, balance: 0 }]);
    qc.setQueryData(reserveKeys.operations(2026), []);
    qc.setQueryData(reserveKeys.incomeActivity("2026-08"), activity);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    fireEvent.click(await screen.findByText("Income"));
    await user.click(await screen.findByRole("button", { name: "Send to reserves" }));
    await user.type(screen.getByLabelText("Description"), "Bonus");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-20" } });
    await user.type(screen.getByLabelText("Amount"), "1000");
    await user.click(screen.getByRole("button", { name: "Save deposit" }));

    await waitFor(() => expect(mocks.createReserveDeposit).toHaveBeenCalledWith({ description: "Bonus", date: "2026-08-20", note: "", allocations: [{ reserve_id: "general", amount: 1000 }] }));
    expect(mocks.createTxn).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: reserveKeys.all });
  });

  it("does not show prior-month reserve activity while the next month loads", async () => {
    let resolveSeptember!: (items: IncomeActivityItem[]) => void;
    mocks.openMonth.mockImplementation((month: string) => Promise.resolve({ ...openMonthPayload(), month, transactions: [normalIncome] }));
    mocks.getIncomeActivity.mockImplementation((month: string) => month === "2026-08"
      ? Promise.resolve(activity)
      : new Promise<IncomeActivityItem[]>((resolve) => { resolveSeptember = resolve; }));
    renderStatefulRecord();
    fireEvent.click(await screen.findByText("Income"));
    expect(await screen.findByRole("heading", { name: "RSU vest" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(await screen.findByText("Income"));
    expect(screen.queryByRole("heading", { name: "RSU vest" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading income activity");
    resolveSeptember([]);
    expect(await screen.findByText("No deposits were sent to reserves this month.")).toBeInTheDocument();
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
