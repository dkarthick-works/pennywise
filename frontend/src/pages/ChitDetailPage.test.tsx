import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChitDetailPage } from "./ChitDetailPage";
import type { ChitDetail } from "../types";

const mocks = {
  getChit: vi.fn(),
  updateChitInstallment: vi.fn(),
  deleteChitInstallment: vi.fn(),
};

vi.mock("../api/chits", () => ({
  getChit: (id: string) => mocks.getChit(id),
  updateChitInstallment: (id: string, iid: string, body: unknown) =>
    mocks.updateChitInstallment(id, iid, body),
  deleteChitInstallment: (id: string, iid: string) => mocks.deleteChitInstallment(id, iid),
}));

function detail(overrides: Partial<ChitDetail> = {}): ChitDetail {
  return {
    id: "c1",
    name: "Office Chit A",
    organizer: "Ramesh",
    chit_value: 100000,
    expected_monthly: 5000,
    total_installments: 2,
    start_month: "2026-07-01",
    installment_count: 1,
    total_paid: 4800,
    status: "active",
    installments: [
      {
        id: "i1",
        paid_on: "2026-07-10",
        amount: 4800,
        note: "",
      },
    ],
    ...overrides,
  };
}

function renderDetail(path = "/chits/c1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/chits/:id" element={<ChitDetailPage />} />
            <Route path="/chits/:id/edit" element={<div>Edit page</div>} />
            <Route path="/chits/:id/installments/new" element={<div>Add installment page</div>} />
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

describe("ChitDetailPage", () => {
  it("shows error state when load fails", async () => {
    mocks.getChit.mockRejectedValue(new Error("missing"));
    renderDetail();
    expect(await screen.findByText(/Could not load this chit/i)).toBeInTheDocument();
  });

  it("shows summary and installments without inline edit/add forms", async () => {
    mocks.getChit.mockResolvedValue(detail());
    renderDetail();
    expect(await screen.findByText("Office Chit A")).toBeInTheDocument();
    expect(screen.getByText("Total personally paid")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText(/do not affect expenses/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Expected installment$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save installment/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save changes/i })).not.toBeInTheDocument();
  });

  it("navigates to edit and add-installment pages", async () => {
    mocks.getChit.mockResolvedValue(detail());
    renderDetail();
    await screen.findByText("Office Chit A");

    fireEvent.click(screen.getByRole("button", { name: /Edit chit/i }));
    expect(await screen.findByText("Edit page")).toBeInTheDocument();
  });

  it("navigates to add installment page", async () => {
    mocks.getChit.mockResolvedValue(detail());
    renderDetail();
    await screen.findByText("Office Chit A");

    fireEvent.click(screen.getByRole("button", { name: /Add installment/i }));
    expect(await screen.findByText("Add installment page")).toBeInTheDocument();
  });

  it("hides add installment when completed", async () => {
    mocks.getChit.mockResolvedValue(
      detail({
        installment_count: 2,
        total_paid: 9800,
        status: "completed",
        installments: [
          { id: "i1", paid_on: "2026-07-10", amount: 4800, note: "" },
          { id: "i2", paid_on: "2026-08-10", amount: 5000, note: "" },
        ],
      }),
    );
    renderDetail();
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/This chit is completed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add installment/i })).not.toBeInTheDocument();
  });
});
