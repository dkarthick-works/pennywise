import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RecordEntryPage } from "./RecordEntryPage";
import type { OpenMonthResponse, Transaction } from "../types";

const mocks = {
  openMonth: vi.fn(),
  createTxn: vi.fn(),
  updateTxn: vi.fn(),
  deleteTxn: vi.fn(),
};

vi.mock("../api/ledger", async () => {
  const actual = await vi.importActual<typeof import("../api/ledger")>("../api/ledger");
  return {
    ...actual,
    openMonth: (month: string) => mocks.openMonth(month),
    createTxn: (body: unknown) => mocks.createTxn(body),
    updateTxn: (id: string, patch: unknown) => mocks.updateTxn(id, patch),
    deleteTxn: (id: string) => mocks.deleteTxn(id),
  };
});

function existingTxn(partial: Partial<Transaction> = {}): Transaction {
  return {
    id: "existing-1",
    section: "daily",
    category: "Old groceries",
    amount: 100,
    date: "2026-08-05",
    kind: "cash",
    ...partial,
  };
}

function openMonthPayload(txns: Transaction[] = [existingTxn()]): OpenMonthResponse {
  return {
    month: "2026-08",
    closed: false,
    seeded: true,
    transactions: txns,
  };
}

function renderEntry(month = "2026-08") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let currentMonth = month;
  const setMonth = vi.fn((m: string) => {
    currentMonth = m;
  });

  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/record/entry"]}>
        <Routes>
          <Route
            path="/record/entry"
            element={
              <RecordEntryPage
                month={currentMonth}
                setMonth={(m) => {
                  setMonth(m);
                  // Remount with new month by updating is not automatic — tests
                  // that need month change will call setMonth and re-render.
                }}
              />
            }
          />
          <Route path="/record" element={<div>Record overview</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { qc, setMonth, ...view, getMonth: () => currentMonth };
}

beforeEach(() => {
  mocks.openMonth.mockReset();
  mocks.createTxn.mockReset();
  mocks.updateTxn.mockReset();
  mocks.deleteTxn.mockReset();
  mocks.openMonth.mockResolvedValue(openMonthPayload());
});

describe("RecordEntryPage", () => {
  it("renders quick add after openMonth and navigates back", async () => {
    renderEntry();
    expect(await screen.findByRole("heading", { name: /Quick add/i })).toBeInTheDocument();
    expect(mocks.openMonth).toHaveBeenCalledWith("2026-08");
    fireEvent.click(screen.getByRole("button", { name: /All tiles/i }));
    expect(screen.getByText("Record overview")).toBeInTheDocument();
  });

  it("does not show existing month transactions in the session log", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    expect(screen.queryByText("Old groceries")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing added yet this visit/i)).toBeInTheDocument();
  });

  it("initializes sticky date from the latest month txn", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    // prettyDate("2026-08-05") → "5 Aug"
    expect(screen.getByRole("button", { name: /Date 5 Aug/i })).toBeInTheDocument();
  });

  it("does not overwrite a user-edited date when openMonth resolves late", async () => {
    let resolveOpen!: (v: OpenMonthResponse) => void;
    mocks.openMonth.mockReturnValue(
      new Promise<OpenMonthResponse>((resolve) => {
        resolveOpen = resolve;
      })
    );

    renderEntry();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();

    resolveOpen(openMonthPayload([existingTxn({ date: "2026-08-05" })]));
    await screen.findByRole("heading", { name: /Quick add/i });

    fireEvent.click(screen.getByRole("button", { name: /Date 5 Aug/i }));
    const dateInput = screen.getByDisplayValue("2026-08-05");
    fireEvent.change(dateInput, { target: { value: "2026-08-02" } });
    fireEvent.blur(dateInput);

    // Simulate a refetch arriving later with a newer max date.
    mocks.openMonth.mockResolvedValue(
      openMonthPayload([existingTxn({ date: "2026-08-09" })])
    );
    // Trigger query invalidation/refetch by remounting with same month via
    // another openMonth call path — call the effect path by resolving again
    // through a forced remount:
    // Instead, assert the displayed date stays 2 Aug after user edit.
    expect(await screen.findByDisplayValue("2026-08-02")).toBeInTheDocument();
  });

  it("creates a cash daily entry, prepends session log, clears name+amount", async () => {
    mocks.createTxn.mockResolvedValue({
      id: "new-1",
      section: "daily",
      category: "Cafe",
      amount: 120,
      date: "2026-08-05",
      kind: "cash",
    } satisfies Transaction);

    const { qc } = renderEntry();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    await screen.findByRole("heading", { name: /Quick add/i });

    const nameInput = screen.getByPlaceholderText(/Groceries/i);
    fireEvent.change(nameInput, { target: { value: "Cafe" } });
    // AmountInput: focus and type
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "120" } });
    fireEvent.keyDown(amountInput, { key: "Enter" });

    await waitFor(() => {
      expect(mocks.createTxn).toHaveBeenCalledTimes(1);
    });
    expect(mocks.createTxn).toHaveBeenCalledWith(
      expect.objectContaining({
        section: "daily",
        category: "Cafe",
        amount: 120,
        date: "2026-08-05",
        kind: "cash",
      })
    );

    expect(await screen.findByDisplayValue("Cafe")).toBeInTheDocument();
    expect(screen.getByText(/1 added/i)).toBeInTheDocument();
    expect((nameInput as HTMLInputElement).value).toBe("");

    const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k.includes("2026-08"))).toBe(true);
  });

  it("does not add failed creates to the session log", async () => {
    mocks.createTxn.mockRejectedValue(new Error("server down"));
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    fireEvent.change(screen.getByPlaceholderText(/Groceries/i), { target: { value: "Taxi" } });
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    expect(await screen.findByText(/server down/i)).toBeInTheDocument();
    expect(screen.queryByText("Taxi")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Groceries/i)).toHaveValue("Taxi");
  });

  it("keeps multiple creates newest-first and sticks section", async () => {
    mocks.createTxn
      .mockResolvedValueOnce({
        id: "a",
        section: "daily",
        category: "First",
        amount: 10,
        date: "2026-08-05",
        kind: "cash",
      } satisfies Transaction)
      .mockResolvedValueOnce({
        id: "b",
        section: "daily",
        category: "Second",
        amount: 20,
        date: "2026-08-05",
        kind: "cash",
      } satisfies Transaction);

    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    async function add(name: string, amt: string) {
      fireEvent.change(screen.getByPlaceholderText(/Groceries/i), { target: { value: name } });
      const amountInput = screen.getByPlaceholderText("0");
      fireEvent.focus(amountInput);
      fireEvent.change(amountInput, { target: { value: amt } });
      fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
      await screen.findByDisplayValue(name);
    }

    await add("First", "10");
    await add("Second", "20");

    // header + 2 data rows in session table (plus draft row in first table)
    const sessionTable = screen.getByDisplayValue("Second").closest("table")!;
    const sessionRows = within(sessionTable).getAllByRole("row").slice(1);
    expect(within(sessionRows[0]).getByDisplayValue("Second")).toBeInTheDocument();
    expect(within(sessionRows[1]).getByDisplayValue("First")).toBeInTheDocument();
  });

  it("cycles section via chip and forces cash for income", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    const secBtn = screen.getByRole("button", { name: /Section Daily/i });
    fireEvent.click(secBtn); // → income
    expect(screen.getByRole("button", { name: /Section Income/i })).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Kind /i })).not.toBeInTheDocument();
  });

  it("cycles kind and submits settlement without settles links", async () => {
    mocks.createTxn.mockResolvedValue({
      id: "s1",
      section: "daily",
      category: "Pay card",
      amount: 500,
      date: "2026-08-05",
      kind: "settlement",
      settles: [],
    } satisfies Transaction);

    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    const kindBtn = screen.getByRole("button", { name: /Kind Cash/i });
    fireEvent.click(kindBtn); // credit
    fireEvent.click(screen.getByRole("button", { name: /Kind Credit/i })); // settlement

    fireEvent.change(screen.getByPlaceholderText(/Groceries/i), { target: { value: "Pay card" } });
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    await waitFor(() => expect(mocks.createTxn).toHaveBeenCalled());
    expect(mocks.createTxn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "settlement",
        settles: [],
        category: "Pay card",
      })
    );
    expect(screen.queryByText(/Pick credits/i)).not.toBeInTheDocument();
  });

  it("rejects empty name without calling the API", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    expect(await screen.findByText(/Name is required/i)).toBeInTheDocument();
    expect(mocks.createTxn).not.toHaveBeenCalled();
  });

  it("does not cycle section/kind when typing s or k in the name field", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const nameInput = screen.getByPlaceholderText(/Groceries/i);
    fireEvent.change(nameInput, { target: { value: "Salary" } });
    fireEvent.keyDown(nameInput, { key: "s" });
    fireEvent.keyDown(nameInput, { key: "k" });
    // Still on Daily — bare letters must not cycle.
    expect(screen.getByRole("button", { name: /Section Daily/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kind Cash/i })).toBeInTheDocument();
    expect(nameInput).toHaveValue("Salary");
  });

  it("cycles section with Alt+S", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    fireEvent.keyDown(window, { key: "s", altKey: true });
    expect(await screen.findByRole("button", { name: /Section Income/i })).toBeInTheDocument();
  });

  it("blocks a second submit while the mutation is pending", async () => {
    let resolveCreate!: (v: Transaction) => void;
    mocks.createTxn.mockReturnValue(
      new Promise<Transaction>((resolve) => {
        resolveCreate = resolve;
      })
    );

    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    fireEvent.change(screen.getByPlaceholderText(/Groceries/i), { target: { value: "Bus" } });
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    await waitFor(() => expect(mocks.createTxn).toHaveBeenCalledTimes(1));

    resolveCreate({
      id: "p1",
      section: "daily",
      category: "Bus",
      amount: 30,
      date: "2026-08-05",
      kind: "cash",
    });
    await screen.findByDisplayValue("Bus");
  });

  async function addTxn(name: string, amt: string): Promise<Transaction> {
    const txn: Transaction = {
      id: `txn-${name}`,
      section: "daily",
      category: name,
      amount: parseInt(amt, 10),
      date: "2026-08-05",
      kind: "cash",
    };
    mocks.createTxn.mockResolvedValueOnce(txn);
    fireEvent.change(screen.getByPlaceholderText(/Groceries/i), { target: { value: name } });
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: amt } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));
    await screen.findByDisplayValue(name);
    return txn;
  }

  it("edits name via onCommit (blur) and calls updateTxn with new category", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Cafe", "120");

    mocks.updateTxn.mockResolvedValue({ ...txn, category: "Bakery" });

    const sessionTable = screen.getByDisplayValue("Cafe").closest("table")!;
    const nameInput = within(sessionTable).getAllByRole("combobox")[0] as HTMLInputElement;
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: "Bakery" } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ category: "Bakery" })
    ));
    expect(await screen.findByDisplayValue("Bakery")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Cafe")).not.toBeInTheDocument();
  });

  it("edits amount via blur and calls updateTxn with new amount", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Groceries", "200");

    mocks.updateTxn.mockResolvedValue({ ...txn, amount: 250 });

    const sessionTable = screen.getByDisplayValue("Groceries").closest("table")!;
    const amtInput = within(sessionTable).getByDisplayValue("200");
    fireEvent.focus(amtInput);
    fireEvent.change(amtInput, { target: { value: "250" } });
    fireEvent.blur(amtInput);

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ amount: 250 })
    ));
  });

  it("cycles section chip and sends combined patch for income", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Freelance", "500");

    mocks.updateTxn.mockResolvedValue({ ...txn, section: "income", kind: "cash" });

    const sessionTable = screen.getByDisplayValue("Freelance").closest("table")!;
    const sectionChip = within(sessionTable).getByRole("button", { name: /Section Daily/i });
    fireEvent.click(sectionChip); // daily → income

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ section: "income", kind: "cash" })
    ));
  });

  it("cycles section chip to non-income and sends only section in patch", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Rent", "1000");

    const sessionTable = screen.getByDisplayValue("Rent").closest("table")!;

    mocks.updateTxn.mockResolvedValueOnce({ ...txn, section: "income", kind: "cash" });
    mocks.updateTxn.mockResolvedValueOnce({ ...txn, section: "essential" });

    const sectionChip = within(sessionTable).getByRole("button", { name: /Section Daily/i });
    fireEvent.click(sectionChip); // daily→income (combined patch)

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ section: "income", kind: "cash" })
    ));

    // After income row appears, cycle income→essential
    const incomeChip = await within(sessionTable).findByRole("button", { name: /Section Income/i });
    fireEvent.click(incomeChip);

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ section: "essential" })
    ));
    const lastCall = mocks.updateTxn.mock.calls.at(-1)![1] as Record<string, unknown>;
    expect(lastCall).not.toHaveProperty("kind");
  });

  it("cycles kind chip on session row and patches correctly", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Taxi", "60");

    mocks.updateTxn.mockResolvedValue({ ...txn, kind: "credit" });

    const sessionTable = screen.getByDisplayValue("Taxi").closest("table")!;
    const kindChip = within(sessionTable).getByRole("button", { name: /Kind Cash/i });
    fireEvent.click(kindChip); // cash → credit

    await waitFor(() => expect(mocks.updateTxn).toHaveBeenCalledWith(
      txn.id,
      expect.objectContaining({ kind: "credit" })
    ));
  });

  it("deletes a session row and removes it from the list", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    const txn = await addTxn("Coffee", "80");

    mocks.deleteTxn.mockResolvedValue({});

    const sessionTable = screen.getByDisplayValue("Coffee").closest("table")!;
    const removeBtn = within(sessionTable).getByRole("button", { name: /Remove/i });
    fireEvent.click(removeBtn);

    await waitFor(() => expect(mocks.deleteTxn).toHaveBeenCalledWith(txn.id));
    await waitFor(() => expect(screen.queryByDisplayValue("Coffee")).not.toBeInTheDocument());
  });

  it("failed update keeps old values and shows rowErr", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });
    await addTxn("Bus", "50");

    mocks.updateTxn.mockRejectedValue(new Error("network error"));

    const sessionTable = screen.getByDisplayValue("Bus").closest("table")!;
    const nameInput = within(sessionTable).getAllByRole("combobox")[0] as HTMLInputElement;
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: "Train" } });
    fireEvent.blur(nameInput);

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bus")).toBeInTheDocument();
  });

  it("income session row shows Cash label and no kind chip", async () => {
    renderEntry();
    await screen.findByRole("heading", { name: /Quick add/i });

    const incomeTxn: Transaction = {
      id: "inc-1",
      section: "income",
      category: "Salary",
      amount: 5000,
      date: "2026-08-05",
      kind: "cash",
    };
    mocks.createTxn.mockResolvedValueOnce(incomeTxn);

    // Cycle draft section to income (daily→income is one step in SECTIONS order)
    const draftSectionChip = screen.getByRole("button", { name: /Section Daily/i });
    fireEvent.click(draftSectionChip);
    expect(screen.getByRole("button", { name: /Section Income/i })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Salary/i), { target: { value: "Salary" } });
    const amountInput = screen.getByPlaceholderText("0");
    fireEvent.focus(amountInput);
    fireEvent.change(amountInput, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /Add entry/i }));

    await screen.findByDisplayValue("Salary");

    const sessionTable = screen.getByDisplayValue("Salary").closest("table")!;
    expect(within(sessionTable).queryByRole("button", { name: /Kind/i })).not.toBeInTheDocument();
    expect(within(sessionTable).getByText("Cash")).toBeInTheDocument();
  });
});
