import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChitEditPage } from "./ChitEditPage";
import type { ChitDetail } from "../types";

const mocks = {
  getChit: vi.fn(),
  updateChit: vi.fn(),
  deleteChit: vi.fn(),
};

vi.mock("../api/chits", () => ({
  getChit: (id: string) => mocks.getChit(id),
  updateChit: (id: string, body: unknown) => mocks.updateChit(id, body),
  deleteChit: (id: string) => mocks.deleteChit(id),
}));

function detail(overrides: Partial<ChitDetail> = {}): ChitDetail {
  return {
    id: "c1",
    name: "Office Chit A",
    organizer: "Ramesh",
    chit_value: 100000,
    expected_monthly: 5000,
    total_installments: 20,
    start_month: "2026-07-01",
    installment_count: 1,
    total_paid: 4800,
    status: "active",
    installments: [{ id: "i1", paid_on: "2026-07-10", amount: 4800, note: "" }],
    ...overrides,
  };
}

function renderEdit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/chits/c1/edit"]}>
          <Routes>
            <Route path="/chits/:id/edit" element={<ChitEditPage />} />
            <Route path="/chits/:id" element={<div>Chit detail</div>} />
            <Route path="/chits" element={<div>Chits list</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

describe("ChitEditPage", () => {
  it("locks meta fields after first installment", async () => {
    mocks.getChit.mockResolvedValue(detail());
    renderEdit();
    await screen.findByDisplayValue("Office Chit A");
    expect(screen.getByLabelText(/^Expected installment$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Total installments$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^Start month$/i)).toBeDisabled();
  });

  it("saves and returns to detail", async () => {
    mocks.getChit.mockResolvedValue(detail({ installment_count: 0, installments: [] }));
    mocks.updateChit.mockResolvedValue(detail());
    renderEdit();
    await screen.findByDisplayValue("Office Chit A");
    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));
    await waitFor(() => expect(mocks.updateChit).toHaveBeenCalled());
    expect(await screen.findByText("Chit detail")).toBeInTheDocument();
  });

  it("confirms cascade delete with installment count", async () => {
    mocks.getChit.mockResolvedValue(detail());
    mocks.deleteChit.mockResolvedValue(undefined);
    renderEdit();
    await screen.findByDisplayValue("Office Chit A");
    fireEvent.click(screen.getByRole("button", { name: /Delete chit/i }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/permanently removes all 1 recorded installment/),
    );
    await waitFor(() => expect(mocks.deleteChit).toHaveBeenCalledWith("c1"));
  });
});
