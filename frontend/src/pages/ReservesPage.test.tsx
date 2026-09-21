import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservesPage } from "./ReservesPage";
import { archiveReserve, createReserve, createReserveDeposit, createReserveSpending, createReserveTransfer, deleteReserveSpending, listReserveOperations, listReserves, renameReserve, updateReserveSpending } from "../api/reserves";

vi.mock("../api/reserves", async (original) => ({
  ...await original<typeof import("../api/reserves")>(),
  listReserves: vi.fn(),
  createReserve: vi.fn(),
  renameReserve: vi.fn(),
  createReserveDeposit: vi.fn(),
  createReserveSpending: vi.fn(),
  createReserveTransfer: vi.fn(),
  archiveReserve: vi.fn(),
  updateReserveSpending: vi.fn(),
  deleteReserveSpending: vi.fn(),
  listReserveOperations: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function mount(initialEntry = "/reserves") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}><ReservesPage /><LocationProbe /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listReserveOperations).mockResolvedValue([]);
  vi.mocked(createReserveSpending).mockResolvedValue({ id: "spend", operation_type: "reserve_spend", date: "2026-09-18", description: "Loan settlement", note: "", total: 100000, entries: [], created_at: "", updated_at: "", editable: true, deletable: true });
  vi.mocked(createReserveTransfer).mockResolvedValue({ id: "transfer", operation_type: "transfer", date: "2026-09-18", description: "Transfer between reserves", note: "", total: 100, entries: [], created_at: "", updated_at: "", editable: false, deletable: true });
  vi.mocked(archiveReserve).mockResolvedValue(undefined);
  vi.mocked(updateReserveSpending).mockResolvedValue({ id: "spend", operation_type: "reserve_spend", date: "2026-09-18", description: "Loan settlement", note: "", total: 100000, entries: [], created_at: "", updated_at: "", editable: true, deletable: true });
});

describe("Reserves page", () => {
  it("uses URL-backed reserve selection in a ledger workspace", async () => {
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "General Reserve", is_general: true, archived: false, balance: 60000 },
      { id: "car", name: "Car Reserve", is_general: false, archived: false, balance: 8000 },
    ]);
    mount("/reserves?reserve=car&year=2025");

    const workspace = await screen.findByRole("region", { name: "Reserve ledger workspace" });
    const sidebar = within(workspace).getByRole("navigation", { name: "Reserve list" });
    expect(within(sidebar).getByRole("button", { name: /Car Reserve.*₹8,000/ })).toHaveAttribute("aria-current", "page");
    const detail = within(workspace).getByRole("region", { name: "Car Reserve details" });
    expect(within(detail).getByRole("heading", { name: "Car Reserve" })).toBeInTheDocument();
    expect(within(detail).getByText("₹8,000")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/reserves?reserve=car&year=2025");
    await waitFor(() => expect(listReserveOperations).toHaveBeenCalledWith(2025, "car", expect.any(AbortSignal)));

    fireEvent.click(within(sidebar).getByRole("button", { name: /General Reserve.*₹60,000/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("reserve=general&year=2025"));
    expect(within(sidebar).getByRole("button", { name: /General Reserve.*₹60,000/ })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(listReserveOperations).toHaveBeenCalledWith(2025, "general", expect.any(AbortSignal)));
  });

  it("opens focused operation dialogs prefilled from the selected reserve", async () => {
    const user = userEvent.setup();
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "General Reserve", is_general: true, archived: false, balance: 60000 },
      { id: "car", name: "Car Reserve", is_general: false, archived: false, balance: 8000 },
    ]);
    mount("/reserves?reserve=car&year=2026");

    const addMoney = await screen.findByRole("button", { name: "Add money" });
    await user.click(addMoney);
    const depositDialog = screen.getByRole("dialog", { name: "Add money to reserves" });
    expect(within(depositDialog).getByLabelText("Reserve 1")).toHaveValue("car");
    await user.click(within(depositDialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(addMoney).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Move out" }));
    expect(screen.getByRole("dialog", { name: "Move money out" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Move to income/ }));
    const incomeDialog = screen.getByRole("dialog", { name: "Move reserve money to income" });
    expect(within(incomeDialog).getByLabelText("Reserve")).toHaveValue("car");
    expect(within(incomeDialog).getByLabelText("Description")).toHaveValue("From Car Reserve");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Transfer" }));
    const transferDialog = screen.getByRole("dialog", { name: "Transfer between reserves" });
    expect(within(transferDialog).getByLabelText("From reserve")).toHaveValue("car");
    expect(within(transferDialog).getByLabelText("To reserve")).toHaveValue("general");
  });

  it("shows aggregate and individual ledger balances with General restrictions", async () => {
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "Rainy Day", is_general: true, archived: false, balance: 2500 },
      { id: "car", name: "Car", is_general: false, archived: false, balance: 750 },
    ]);
    mount();

    expect(screen.getByRole("status")).toHaveTextContent("Loading reserves");
    expect(await screen.findByRole("heading", { name: "Reserves" })).toBeInTheDocument();
    expect(screen.getAllByText("₹3,250").length).toBeGreaterThan(0);
    expect(screen.getByText("2/5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rainy Day" })).toBeInTheDocument();
    expect(screen.getByText("General reserve")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(screen.getByRole("dialog", { name: "Manage Rainy Day" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive reserve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete reserve" })).not.toBeInTheDocument();
  });

  it("creates and renames reserves with accessible validation", async () => {
    const user = userEvent.setup();
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "General Reserve", is_general: true, archived: false, balance: 0 },
    ]);
    vi.mocked(createReserve).mockResolvedValue({ id: "travel", name: "Travel", is_general: false, archived: false, balance: 0 });
    vi.mocked(renameReserve).mockResolvedValue({ id: "general", name: "Safety Net", is_general: true, archived: false, balance: 0 });
    mount();
    await screen.findByText("1/5");

    fireEvent.click(screen.getByRole("button", { name: "Create reserve" }));
    expect(screen.getByLabelText("Reserve name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Save reserve" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reserve name is required");
    const createName = screen.getByLabelText("Reserve name");
    expect(createName).toHaveAttribute("aria-describedby", "create-reserve-name-error");
    fireEvent.change(createName, { target: { value: "  Travel  " } });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(createReserve).toHaveBeenCalledWith({ name: "Travel" }));

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    const renameName = screen.getByLabelText("New name for General Reserve");
    expect(renameName).toHaveFocus();
    fireEvent.change(renameName, { target: { value: " Safety Net " } });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(renameReserve).toHaveBeenCalledWith("general", { name: "Safety Net" }));
  });

  it("creates a split deposit and renders reverse-chronological allocation history", async () => {
    const user = userEvent.setup();
    const reserves = [
      { id: "general", name: "General Reserve", is_general: true, archived: false, balance: 60000 },
      { id: "ceremony", name: "Ceremony Reserve", is_general: false, archived: false, balance: 100000 },
      { id: "loan", name: "Loan Reserve", is_general: false, archived: false, balance: 100000 },
    ];
    vi.mocked(listReserves).mockResolvedValue(reserves);
    vi.mocked(listReserveOperations).mockResolvedValue([
      {
        id: "newer", operation_type: "deposit", date: "2026-09-18", description: "RSU vest", note: "September vest", total: 260000,
        entries: [
          { id: "e1", reserve_id: "ceremony", reserve_name: "Ceremony Reserve", direction: "deposit", amount: 100000 },
          { id: "e2", reserve_id: "loan", reserve_name: "Loan Reserve", direction: "deposit", amount: 100000 },
          { id: "e3", reserve_id: "general", reserve_name: "General Reserve", direction: "deposit", amount: 60000 },
        ], created_at: "2026-09-18T12:00:00Z", updated_at: "2026-09-18T12:00:00Z", editable: false, deletable: false,
      },
      { id: "older", operation_type: "deposit", date: "2026-01-01", description: "Older bonus", note: "", total: 10, entries: [], created_at: "2026-01-01T12:00:00Z", updated_at: "2026-01-01T12:00:00Z", editable: false, deletable: false },
    ]);
    vi.mocked(createReserveDeposit).mockResolvedValue({
      id: "created", operation_type: "deposit", date: "2026-09-18", description: "RSU vest", note: "", total: 260000, entries: [], created_at: "", updated_at: "", editable: false, deletable: false,
    });
    mount();

    expect((await screen.findAllByText("₹2,60,000")).length).toBeGreaterThan(0);
    expect(await screen.findByText("RSU vest")).toBeInTheDocument();
    expect(await screen.findByText("Older bonus")).toBeInTheDocument();
    expect(await screen.findByText(/Ceremony Reserve ₹1,00,000/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add money" }));
    await user.type(screen.getByLabelText("Description"), "RSU vest");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-18" } });
    fireEvent.change(screen.getByLabelText("Reserve 1"), { target: { value: "ceremony" } });
    await user.type(screen.getByLabelText("Amount"), "100000");
    await user.click(screen.getByRole("button", { name: "Add allocation" }));
    fireEvent.change(screen.getByLabelText("Reserve 2"), { target: { value: "loan" } });
    await user.type(screen.getAllByLabelText("Amount")[1], "100000");
    await user.click(screen.getByRole("button", { name: "Add allocation" }));
    fireEvent.change(screen.getByLabelText("Reserve 3"), { target: { value: "general" } });
    await user.type(screen.getAllByLabelText("Amount")[2], "60000");
    expect(screen.getByText((_, element) => element?.classList.contains("reserve-deposit-total") === true && element.textContent === "Total allocated: ₹2,60,000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save deposit" }));
    await waitFor(() => expect(createReserveDeposit).toHaveBeenCalledWith({
      description: "RSU vest", date: "2026-09-18", note: "",
      allocations: [
        { reserve_id: "ceremony", amount: 100000 },
        { reserve_id: "loan", amount: 100000 },
        { reserve_id: "general", amount: 60000 },
      ],
    }));
  });

  it("validates and submits a single exact allocation", async () => {
    const user = userEvent.setup();
    vi.mocked(listReserves).mockResolvedValue([{ id: "general", name: "General Reserve", is_general: true, archived: false, balance: 0 }]);
    vi.mocked(createReserveDeposit).mockResolvedValue({ id: "deposit", operation_type: "deposit", date: "2026-09-18", description: "Bonus", note: "", total: 10.25, entries: [], created_at: "", updated_at: "", editable: false, deletable: false });
    mount();
    await user.click(await screen.findByRole("button", { name: "Add money" }));
    await user.click(screen.getByRole("button", { name: "Save deposit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Description is required");

    await user.type(screen.getByLabelText("Description"), "Bonus");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-18" } });
    await user.type(screen.getByLabelText("Amount"), "1.001");
    await user.click(screen.getByRole("button", { name: "Save deposit" }));
    expect(screen.getByRole("alert")).toHaveTextContent("no more than two decimal places");
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10.25" } });
    await user.click(screen.getByRole("button", { name: "Save deposit" }));
    await waitFor(() => expect(createReserveDeposit).toHaveBeenCalledWith({
      description: "Bonus", date: "2026-09-18", note: "", allocations: [{ reserve_id: "general", amount: 10.25 }],
    }));
  });

  it("records, edits, and deletes reserve-only spending without normal analytics copy", async () => {
    const user = userEvent.setup();
    vi.mocked(listReserves).mockResolvedValue([{ id: "loan", name: "Loan Reserve", is_general: false, archived: false, balance: 100000 }]);
    vi.mocked(listReserveOperations).mockResolvedValue([{
      id: "spend", operation_type: "reserve_spend", date: "2026-09-18", description: "Loan settlement", note: "Final payment", total: 40000,
      entries: [{ id: "entry", reserve_id: "loan", reserve_name: "Loan Reserve", direction: "withdrawal", amount: 40000 }], created_at: "2026-09-18T10:00:00Z", updated_at: "2026-09-18T10:00:00Z", editable: true, deletable: true,
    }]);
    mount();
    await user.click(await screen.findByRole("button", { name: "Spend" }));
    expect(screen.getByText(/will not appear in normal spending/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "100000");
    await user.type(screen.getByLabelText("Description"), "Loan settlement");
    await user.click(screen.getByRole("button", { name: "Save spending" }));
    await waitFor(() => expect(createReserveSpending).toHaveBeenCalledWith({ reserve_id: "loan", amount: 100000, date: expect.any(String), description: "Loan settlement", note: "" }));

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Amount"));
    await user.type(screen.getByLabelText("Amount"), "35000");
    await user.click(screen.getByRole("button", { name: "Save spending" }));
    await waitFor(() => expect(updateReserveSpending).toHaveBeenCalledWith("spend", expect.objectContaining({ reserve_id: "loan", amount: 35000 })));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete reserve operation" }));
    await waitFor(() => expect(deleteReserveSpending).toHaveBeenCalledWith("spend"));
  });

  it("transfers between active reserves and archives a zero-balance reserve", async () => {
    const user = userEvent.setup();
    const active = [
      { id: "one", name: "One Reserve", is_general: true, archived: false, balance: 0 },
      { id: "two", name: "Two Reserve", is_general: false, archived: false, balance: 0 },
    ];
    const archived = { id: "old", name: "Old Reserve", is_general: false, archived: true, balance: 0 };
    vi.mocked(listReserves).mockImplementation((includeArchived = false) => Promise.resolve(includeArchived ? [...active, archived] : active));
    mount();
    await user.click(await screen.findByRole("button", { name: "Transfer" }));
    await user.type(screen.getByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Save transfer" }));
    await waitFor(() => expect(createReserveTransfer).toHaveBeenCalledWith({ from_reserve_id: "one", to_reserve_id: "two", amount: 100, date: expect.any(String), note: "" }));
    await user.click(screen.getByRole("button", { name: /Archived/ }));
    expect(screen.getByText("Old Reserve")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Two Reserve/ }));
    await user.click(screen.getByRole("button", { name: "Manage" }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Archive reserve" }));
    await waitFor(() => expect(archiveReserve).toHaveBeenCalledWith("two"));
  });

  it("offers retryable error and empty states", async () => {
    vi.mocked(listReserves).mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load reserves");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No reserves are available yet.")).toBeInTheDocument();
  });
});
