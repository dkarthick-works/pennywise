import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChitInstallmentCreatePage } from "./ChitInstallmentCreatePage";
import type { ChitDetail } from "../types";

const mocks = {
  getChit: vi.fn(),
  createChitInstallment: vi.fn(),
};

vi.mock("../api/chits", () => ({
  getChit: (id: string) => mocks.getChit(id),
  createChitInstallment: (id: string, body: unknown) => mocks.createChitInstallment(id, body),
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
    installment_count: 0,
    total_paid: 0,
    status: "active",
    installments: [],
    ...overrides,
  };
}

function renderCreate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/chits/c1/installments/new"]}>
          <Routes>
            <Route path="/chits/:id/installments/new" element={<ChitInstallmentCreatePage />} />
            <Route path="/chits/:id" element={<div>Chit detail</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("ChitInstallmentCreatePage", () => {
  it("blocks create when completed", async () => {
    mocks.getChit.mockResolvedValue(
      detail({ installment_count: 20, status: "completed", total_paid: 100000 }),
    );
    renderCreate();
    expect(await screen.findByText(/This chit is completed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save installment/i })).not.toBeInTheDocument();
  });

  it("creates installment, invalidates cache, returns to detail", async () => {
    mocks.getChit.mockResolvedValue(detail());
    mocks.createChitInstallment.mockResolvedValue({
      id: "i1",
      paid_on: "2026-07-10",
      amount: 5000,
      note: "",
    });
    const { qc } = renderCreate();
    const spy = vi.spyOn(qc, "invalidateQueries");

    await screen.findByText(/Add installment/i);
    fireEvent.change(screen.getByLabelText(/Amount paid/i), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/Paid on/i), { target: { value: "2026-07-10" } });
    fireEvent.click(screen.getByRole("button", { name: /Save installment/i }));

    await waitFor(() => expect(mocks.createChitInstallment).toHaveBeenCalled());
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["chit", "c1"] }),
    );
    expect(await screen.findByText("Chit detail")).toBeInTheDocument();
  });
});
