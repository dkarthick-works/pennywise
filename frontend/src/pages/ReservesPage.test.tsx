import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservesPage } from "./ReservesPage";
import { createReserve, listReserves, renameReserve } from "../api/reserves";

vi.mock("../api/reserves", async (original) => ({
  ...await original<typeof import("../api/reserves")>(),
  listReserves: vi.fn(),
  createReserve: vi.fn(),
  renameReserve: vi.fn(),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><ReservesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("Reserves page", () => {
  it("shows aggregate and individual ledger balances with General restrictions", async () => {
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "Rainy Day", is_general: true, archived: false, balance: 2500 },
      { id: "car", name: "Car", is_general: false, archived: false, balance: 750 },
    ]);
    mount();

    expect(screen.getByRole("status")).toHaveTextContent("Loading reserves");
    expect(await screen.findByRole("heading", { name: "Reserves" })).toBeInTheDocument();
    expect(screen.getByText("₹3,250")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 active reserves")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rainy Day" })).toBeInTheDocument();
    expect(screen.getByText("General Reserve")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Rainy Day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Rainy Day" })).not.toBeInTheDocument();
  });

  it("creates and renames reserves with accessible validation", async () => {
    const user = userEvent.setup();
    vi.mocked(listReserves).mockResolvedValue([
      { id: "general", name: "General Reserve", is_general: true, archived: false, balance: 0 },
    ]);
    vi.mocked(createReserve).mockResolvedValue({ id: "travel", name: "Travel", is_general: false, archived: false, balance: 0 });
    vi.mocked(renameReserve).mockResolvedValue({ id: "general", name: "Safety Net", is_general: true, archived: false, balance: 0 });
    mount();
    await screen.findByText("1 of 5 active reserves");

    fireEvent.click(screen.getByRole("button", { name: "Create reserve" }));
    expect(screen.getByLabelText("Reserve name")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Save reserve" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reserve name is required");
    const createName = screen.getByLabelText("Reserve name");
    expect(createName).toHaveAttribute("aria-describedby", "create-reserve-name-error");
    fireEvent.change(createName, { target: { value: "  Travel  " } });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(createReserve).toHaveBeenCalledWith({ name: "Travel" }));

    fireEvent.click(screen.getByRole("button", { name: "Rename General Reserve" }));
    const renameName = screen.getByLabelText("New name for General Reserve");
    expect(renameName).toHaveFocus();
    fireEvent.change(renameName, { target: { value: " Safety Net " } });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(renameReserve).toHaveBeenCalledWith("general", { name: "Safety Net" }));
  });

  it("offers retryable error and empty states", async () => {
    vi.mocked(listReserves).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load reserves");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No reserves are available yet.")).toBeInTheDocument();
  });
});
