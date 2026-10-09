import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchTransactions } from "../../api/ledger";
import type { Transaction, TransactionSearchResponse } from "../../types";
import { TransactionSearch } from "./TransactionSearch";

vi.mock("../../api/ledger", () => ({ searchTransactions: vi.fn() }));
const search = vi.mocked(searchTransactions);
const clients: QueryClient[] = [];
const coffee: Transaction = { id: "coffee", category: "Coffee Shop", date: "2025-01-02", amount: 120, section: "daily", kind: "cash" };
const result: TransactionSearchResponse = { items: [coffee], has_more: false, next_cursor: null };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><TransactionSearch /></QueryClientProvider>);
  return screen.getByRole("searchbox", { name: "Search transactions" });
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("transaction search", () => {
  it("debounces for 100 ms, coalesces edits and never searches blank input", async () => {
    vi.useFakeTimers();
    search.mockResolvedValue(result);
    const input = setup();
    fireEvent.change(input, { target: { value: "   " } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "co" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(75); });
    fireEvent.change(input, { target: { value: " coffee " } });
    await act(async () => { await vi.advanceTimersByTimeAsync(99); });
    expect(search).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("coffee", expect.any(AbortSignal));
  });

  it("debounces returning to the previous query and whitespace-only edits", async () => {
    vi.useFakeTimers();
    search.mockResolvedValue(result);
    const input = setup();
    fireEvent.change(input, { target: { value: "coffee" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(101); });
    expect(search).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "coffe" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.change(input, { target: { value: "coffee" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(99); });
    expect(search).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(search).toHaveBeenCalledTimes(2);
    fireEvent.change(input, { target: { value: "coffee " } });
    await act(async () => { await vi.advanceTimersByTimeAsync(101); });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("shows returned transactions across months and clears them immediately", async () => {
    search.mockResolvedValue(result);
    const input = setup();
    fireEvent.change(input, { target: { value: "coffee" } });
    expect(screen.getByRole("status")).toHaveTextContent("Searching transactions");
    expect(await screen.findByText("Coffee Shop")).toBeInTheDocument();
    expect(screen.getByText("Across all months")).toBeInTheDocument();
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByText("2 Jan 2025")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear transaction search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.queryByText("Coffee Shop")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("cancels old requests as soon as the text changes and ignores late results", async () => {
    let resolveOld: ((value: TransactionSearchResponse) => void) | undefined;
    search.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    search.mockResolvedValueOnce({ ...result, items: [{ ...coffee, id: "rent", category: "Rent" }] });
    const input = setup();
    fireEvent.change(input, { target: { value: "coffee" } });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const oldSignal = search.mock.calls[0][1];
    fireEvent.change(input, { target: { value: "rent" } });
    expect(oldSignal?.aborted).toBe(true);
    expect(await screen.findByText("Rent")).toBeInTheDocument();
    await act(async () => { resolveOld?.(result); });
    expect(screen.queryByText("Coffee Shop")).not.toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
  });

  it("shows an empty state", async () => {
    search.mockResolvedValue({ items: [], has_more: false, next_cursor: null });
    fireEvent.change(setup(), { target: { value: "missing" } });
    expect(await screen.findByText("No matching transactions.")).toBeInTheDocument();
  });

  it("shows errors and allows retrying the same search", async () => {
    search.mockRejectedValueOnce(new Error("offline"));
    search.mockResolvedValueOnce(result);
    fireEvent.change(setup(), { target: { value: "coffee" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not search transactions");
    fireEvent.click(screen.getByRole("button", { name: "Retry search" }));
    expect(await screen.findByText("Coffee Shop")).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("makes the initial page limit clear when more matches exist", async () => {
    search.mockResolvedValue({ ...result, has_more: true, next_cursor: "next" });
    fireEvent.change(setup(), { target: { value: "coffee" } });
    expect(await screen.findByText("Showing first 1 match")).toBeInTheDocument();
  });
});
