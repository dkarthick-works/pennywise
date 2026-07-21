import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChitCreatePage } from "./ChitCreatePage";
import type { ChitSummary } from "../types";

const mocks = {
  createChit: vi.fn(),
};

vi.mock("../api/chits", () => ({
  createChit: (body: unknown) => mocks.createChit(body),
}));

function sampleChit(): ChitSummary {
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
  };
}

function renderCreate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/chits/new"]}>
          <Routes>
            <Route path="/chits/new" element={<ChitCreatePage />} />
            <Route path="/chits" element={<div>Chits list</div>} />
            <Route path="/chits/:id" element={<div>Chit detail</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mocks.createChit.mockReset();
});

describe("ChitCreatePage", () => {
  it("has start-month input and back navigation", () => {
    renderCreate();
    expect(screen.getByLabelText(/Start month/i)).toHaveAttribute("type", "month");
    fireEvent.click(screen.getByRole("button", { name: /All chits/i }));
    expect(screen.getByText("Chits list")).toBeInTheDocument();
  });

  it("validates before calling API", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: /Save chit/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mocks.createChit).not.toHaveBeenCalled();
  });

  it("creates with YYYY-MM-01, invalidates list, opens detail", async () => {
    mocks.createChit.mockResolvedValue(sampleChit());
    const { qc } = renderCreate();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    fireEvent.change(screen.getByLabelText(/^Name$/i), { target: { value: "Office Chit A" } });
    fireEvent.change(screen.getByLabelText(/Organizer/i), { target: { value: "Ramesh" } });
    fireEvent.change(screen.getByLabelText(/Chit value/i), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText(/Expected installment/i), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/Total installments/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/Start month/i), { target: { value: "2026-07" } });
    fireEvent.click(screen.getByRole("button", { name: /Save chit/i }));

    await waitFor(() =>
      expect(mocks.createChit).toHaveBeenCalledWith(
        expect.objectContaining({ start_month: "2026-07-01", name: "Office Chit A" }),
      ),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["chits"] }),
    );
    expect(await screen.findByText("Chit detail")).toBeInTheDocument();
  });

  it("Cancel returns to list", () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.getByText("Chits list")).toBeInTheDocument();
  });
});
