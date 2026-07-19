import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "./SettingsPage";
import type { Settings } from "../types";

const mocks = {
  getSettings: vi.fn(),
  updateCreditStatementDay: vi.fn(),
  updateBudgets: vi.fn(),
  updatePreferences: vi.fn(),
  putTemplates: vi.fn(),
};

vi.mock("../api/ledger", async (importActual) => {
  const actual = await importActual<typeof import("../api/ledger")>();
  return {
    ...actual,
    getSettings: () => mocks.getSettings(),
    updateCreditStatementDay: (d: number | null) => mocks.updateCreditStatementDay(d),
    updateBudgets: (b: unknown) => mocks.updateBudgets(b),
    updatePreferences: (b: unknown) => mocks.updatePreferences(b),
    putTemplates: (s: unknown, l: unknown) => mocks.putTemplates(s, l),
  };
});

function settings(day: number | null): Settings {
  return {
    budgets: { essential: 0, flexible: 0, daily: 0 },
    currency: "INR",
    theme: "light",
    templates: { essential: [], flexible: [] },
    credit_statement_day: day,
  };
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>
  );
  return { qc, ...utils };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.updateCreditStatementDay.mockImplementation((d: number | null) => Promise.resolve(settings(d)));
});

describe("Settings — credit billing cycle", () => {
  it("hydrates the saved statement day after the async query resolves", async () => {
    mocks.getSettings.mockResolvedValue(settings(15));
    renderSettings();

    const select = await screen.findByDisplayValue("15th");
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/billing cycle:/i)).toHaveTextContent("16 June – 15 July");
  });

  it("saves the selected day via the dedicated endpoint", async () => {
    mocks.getSettings.mockResolvedValue(settings(null));
    renderSettings();

    // Wait for load; default is "Not set".
    await screen.findByText("Credit card billing cycle");
    const select = screen.getAllByRole("combobox")[0];
    fireEvent.change(select, { target: { value: "20" } });

    const save = screen.getByRole("button", { name: /Save billing cycle/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(mocks.updateCreditStatementDay).toHaveBeenCalledWith(20));
  });

  it("clears the setting with the Clear action", async () => {
    mocks.getSettings.mockResolvedValue(settings(15));
    renderSettings();

    await screen.findByDisplayValue("15th");
    const clear = screen.getByRole("button", { name: /^Clear$/i });
    fireEvent.click(clear);

    await waitFor(() => expect(mocks.updateCreditStatementDay).toHaveBeenCalledWith(null));
  });

  it("does not overwrite an in-progress edit when settings data changes", async () => {
    mocks.getSettings.mockResolvedValue(settings(null));
    const { qc } = renderSettings();

    await screen.findByText("Credit card billing cycle");
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3" } });
    expect(select.value).toBe("3");

    // A background refetch delivers a different saved value; the dirty edit stays.
    qc.setQueryData(["settings"], settings(15));
    await waitFor(() => expect(select.value).toBe("3"));
  });
});
