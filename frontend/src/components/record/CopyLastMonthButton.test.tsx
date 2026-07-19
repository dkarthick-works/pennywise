import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyLastMonthButton } from "./CopyLastMonthButton";
import type { Section, Transaction } from "../../types";

const getTxnsByMonth = vi.fn();
const importTransactions = vi.fn();
const updateTxn = vi.fn();

vi.mock("../../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../../api/ledger")>();
  return {
    ...actual,
    getTxnsByMonth: (m: string) => getTxnsByMonth(m),
    importTransactions: (rows: unknown) => importTransactions(rows),
    updateTxn: (id: string, patch: unknown) => updateTxn(id, patch),
  };
});

let seq = 0;
function txn(p: Partial<Transaction> & { section: Section }): Transaction {
  seq += 1;
  return {
    id: p.id ?? `t${seq}`,
    section: p.section,
    category: p.category ?? "Rent",
    amount: p.amount ?? 100,
    date: p.date ?? "2026-06-10",
    kind: p.kind ?? "cash",
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderButton(opts: {
  section?: Section;
  currentTxns?: Transaction[];
  onPendingChange?: (p: boolean) => void;
  onCopied?: () => void;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onPendingChange = opts.onPendingChange ?? vi.fn();
  const onCopied = opts.onCopied ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CopyLastMonthButton
        section={opts.section ?? "essential"}
        month="2026-07"
        currentTxns={opts.currentTxns ?? []}
        onPendingChange={onPendingChange}
        onCopied={onCopied}
      />
    </QueryClientProvider>
  );
  return { onPendingChange, onCopied };
}

beforeEach(() => {
  getTxnsByMonth.mockReset();
  importTransactions.mockReset();
  updateTxn.mockReset();
});

describe("CopyLastMonthButton — empty & cancel", () => {
  it("shows a quiet message and writes nothing when nothing is eligible", async () => {
    getTxnsByMonth.mockResolvedValue([]);
    const { onPendingChange, onCopied } = renderButton({});

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));

    expect(await screen.findByText(/No eligible Essential transactions in June 2026\./i)).toBeInTheDocument();
    expect(importTransactions).not.toHaveBeenCalled();
    expect(updateTxn).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
    // Pending was raised then cleared.
    expect(onPendingChange).toHaveBeenCalledWith(true);
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it("cancel confirmation performs no writes, no filter clear, and clears pending", async () => {
    getTxnsByMonth.mockResolvedValue([txn({ section: "essential", category: "Rent", amount: 500 })]);
    const { onPendingChange, onCopied } = renderButton({});

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(importTransactions).not.toHaveBeenCalled();
    expect(updateTxn).not.toHaveBeenCalled();
    expect(onCopied).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });
});

describe("CopyLastMonthButton — confirm counts", () => {
  it("previews exact fill and insert counts", async () => {
    getTxnsByMonth.mockResolvedValue([
      txn({ section: "essential", category: "Rent", amount: 25000 }),
      txn({ section: "essential", category: "EMI", amount: 5000 }),
    ]);
    renderButton({
      currentTxns: [txn({ id: "zeroRent", section: "essential", category: "Rent", amount: 0, kind: "cash" })],
    });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));

    expect(
      await screen.findByText(
        /Copy 2 transactions from June 2026 into July 2026\? 1 existing zero-value cash row will be filled and 1 new row will be added\. Other existing rows will not be replaced\./i
      )
    ).toBeInTheDocument();
  });
});

describe("CopyLastMonthButton — success", () => {
  it("imports inserts, fills matches, invalidates, and reports counts distinguishing fills vs inserts", async () => {
    getTxnsByMonth.mockResolvedValue([
      txn({ section: "essential", category: "Rent", amount: 25000, date: "2026-06-03" }),
      txn({ section: "essential", category: "EMI", amount: 5000, date: "2026-06-15" }),
    ]);
    importTransactions.mockResolvedValue({ imported: 1, months: ["2026-07"] });
    updateTxn.mockResolvedValue({});
    const { onCopied } = renderButton({
      currentTxns: [txn({ id: "zeroRent", section: "essential", category: "Rent", amount: 0, kind: "cash" })],
    });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByText(/Added 1 row; filled 1 matching zero-value row from June\./i)).toBeInTheDocument();
    expect(importTransactions).toHaveBeenCalledTimes(1);
    expect(importTransactions).toHaveBeenCalledWith([
      { date: "2026-07-15", section: "essential", category: "EMI", amount: 5000, kind: "cash" },
    ]);
    expect(updateTxn).toHaveBeenCalledWith("zeroRent", { date: "2026-07-03", amount: 25000, kind: "cash", category: "Rent" });
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it("only-fill path does not call importTransactions", async () => {
    getTxnsByMonth.mockResolvedValue([txn({ section: "flexible", category: "Gym", amount: 800 })]);
    updateTxn.mockResolvedValue({});
    renderButton({
      section: "flexible",
      currentTxns: [txn({ id: "z", section: "flexible", category: "Gym", amount: 0, kind: "cash" })],
    });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByText(/filled 1 matching zero-value row from June\./i)).toBeInTheDocument();
    expect(importTransactions).not.toHaveBeenCalled();
    expect(updateTxn).toHaveBeenCalledTimes(1);
  });

  it("allows a repeat copy after a full success", async () => {
    getTxnsByMonth.mockResolvedValue([txn({ section: "income", category: "Salary", amount: 1000, kind: "cash" })]);
    importTransactions.mockResolvedValue({ imported: 1, months: ["2026-07"] });
    renderButton({ section: "income" });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));
    await screen.findByText(/Added 1 row from June\./i);

    // Button is enabled again and can start a fresh flow.
    const trigger = screen.getByRole("button", { name: /copy last month/i });
    expect(trigger).toBeEnabled();
    await userEvent.click(trigger);
    await screen.findByRole("dialog");
    expect(importTransactions).toHaveBeenCalledTimes(1); // second confirm not yet clicked
  });
});

describe("CopyLastMonthButton — failures & pending", () => {
  it("load error reports a retry message and writes nothing", async () => {
    getTxnsByMonth.mockRejectedValue(new Error("network"));
    renderButton({});

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));

    expect(await screen.findByText(/Couldn't load June 2026 transactions\. Try again\./i)).toBeInTheDocument();
    expect(importTransactions).not.toHaveBeenCalled();
  });

  it("atomic import failure adds no rows and does not attempt fills", async () => {
    getTxnsByMonth.mockResolvedValue([
      txn({ section: "essential", category: "Rent", amount: 25000 }),
      txn({ section: "essential", category: "EMI", amount: 5000 }),
    ]);
    importTransactions.mockRejectedValue(new Error("Import failed"));
    renderButton({
      currentTxns: [txn({ id: "zeroRent", section: "essential", category: "Rent", amount: 0, kind: "cash" })],
    });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(await screen.findByText(/Couldn't copy transactions\. No rows were added\./i)).toBeInTheDocument();
    expect(updateTxn).not.toHaveBeenCalled();
  });

  it("inserts succeed but a fill fails → partial counts with a retry warning", async () => {
    getTxnsByMonth.mockResolvedValue([
      txn({ section: "essential", category: "Rent", amount: 25000 }),
      txn({ section: "essential", category: "EMI", amount: 5000 }),
    ]);
    importTransactions.mockResolvedValue({ imported: 1, months: ["2026-07"] });
    updateTxn.mockRejectedValue(new Error("fill failed"));
    renderButton({
      currentTxns: [txn({ id: "zeroRent", section: "essential", category: "Rent", amount: 0, kind: "cash" })],
    });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(
      await screen.findByText(/Added 1 row; filled 0 of 1 matching rows from June\. Do not retry — that would add the new rows again\./i)
    ).toBeInTheDocument();
  });

  it("shows Copying… and disables the trigger while writing, and toggles pending true→false", async () => {
    getTxnsByMonth.mockResolvedValue([txn({ section: "income", category: "Salary", amount: 1000, kind: "cash" })]);
    const gate = deferred<{ imported: number; months: string[] }>();
    importTransactions.mockReturnValue(gate.promise);
    const onPendingChange = vi.fn();
    renderButton({ section: "income", onPendingChange });

    await userEvent.click(screen.getByRole("button", { name: /copy last month/i }));
    expect(onPendingChange).toHaveBeenCalledWith(true);
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /^copy$/i }));

    // Writing phase: trigger relabels and is disabled.
    const trigger = await screen.findByRole("button", { name: /copying…/i });
    expect(trigger).toBeDisabled();
    // Still pending (not cleared yet).
    expect(onPendingChange).not.toHaveBeenLastCalledWith(false);

    gate.resolve({ imported: 1, months: ["2026-07"] });
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
    await screen.findByText(/Added 1 row from June\./i);
  });
});
