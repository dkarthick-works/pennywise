import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "./SettingsPage";
import type { Settings } from "../types";

const mocks = {
  getSettings: vi.fn(),
  updateCreditStatementDay: vi.fn(),
  updateCreditSpendingThreshold: vi.fn(),
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
    updateCreditSpendingThreshold: (v: number | null) => mocks.updateCreditSpendingThreshold(v),
    updateBudgets: (b: unknown) => mocks.updateBudgets(b),
    updatePreferences: (b: unknown) => mocks.updatePreferences(b),
    putTemplates: (s: unknown, l: unknown) => mocks.putTemplates(s, l),
  };
});

function settings(day: number | null, threshold: number | null = null): Settings {
  return {
    budgets: { essential: 0, flexible: 0, daily: 0 },
    currency: "INR",
    theme: "light",
    templates: { essential: [], flexible: [] },
    credit_statement_day: day,
    credit_spending_threshold: threshold,
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
  mocks.updateCreditSpendingThreshold.mockImplementation((v: number | null) => Promise.resolve(settings(15, v)));
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
    await screen.findByText("Credit card controls");
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
    // Two "Clear" buttons exist (billing + threshold); the billing one renders first.
    const clear = screen.getAllByRole("button", { name: /^Clear$/i })[0];
    fireEvent.click(clear);

    await waitFor(() => expect(mocks.updateCreditStatementDay).toHaveBeenCalledWith(null));
  });

  it("does not overwrite an in-progress edit when settings data changes", async () => {
    mocks.getSettings.mockResolvedValue(settings(null));
    const { qc } = renderSettings();

    await screen.findByText("Credit card controls");
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "3" } });
    expect(select.value).toBe("3");

    // A background refetch delivers a different saved value; the dirty edit stays.
    qc.setQueryData(["settings"], settings(15));
    await waitFor(() => expect(select.value).toBe("3"));
  });
});

// Scope queries to the threshold control (there are two "Clear" buttons on the card).
function thresholdSection(container: HTMLElement) {
  const el = container.querySelector("#credit-spending-threshold") as HTMLElement;
  return within(el);
}

describe("Settings — credit spending threshold", () => {
  it("hydrates the saved threshold after the async query resolves", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, 25000));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const input = thresholdSection(container).getByLabelText(
      "Credit spending threshold amount"
    ) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("25000"));
  });

  it("saves a positive amount via the dedicated endpoint", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, null));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const section = thresholdSection(container);
    const input = section.getByLabelText("Credit spending threshold amount");
    fireEvent.change(input, { target: { value: "25000.50" } });

    const save = section.getByRole("button", { name: /Save threshold/i });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.updateCreditSpendingThreshold).toHaveBeenCalledWith(25000.5)
    );
  });

  it("clears the threshold with the Clear action (explicit null)", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, 25000));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const section = thresholdSection(container);
    await waitFor(() =>
      expect(
        (section.getByLabelText("Credit spending threshold amount") as HTMLInputElement).value
      ).toBe("25000")
    );

    fireEvent.click(section.getByRole("button", { name: /^Clear$/i }));
    await waitFor(() =>
      expect(mocks.updateCreditSpendingThreshold).toHaveBeenCalledWith(null)
    );
  });

  it("disables Save and shows an error for more than two decimals", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, null));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const section = thresholdSection(container);
    const input = section.getByLabelText("Credit spending threshold amount");
    fireEvent.change(input, { target: { value: "100.501" } });

    expect(section.getByRole("button", { name: /Save threshold/i })).toBeDisabled();
    expect(
      section.getByText(/positive amount with at most two decimal places/i)
    ).toBeInTheDocument();
    expect(mocks.updateCreditSpendingThreshold).not.toHaveBeenCalled();
  });

  it("retains the draft after a failed save and allows retry", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, null));
    mocks.updateCreditSpendingThreshold
      .mockRejectedValueOnce(new Error("nope"))
      .mockImplementationOnce((v: number | null) => Promise.resolve(settings(15, v)));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const section = thresholdSection(container);
    const input = section.getByLabelText("Credit spending threshold amount") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(section.getByRole("button", { name: /Save threshold/i }));

    // Failure surfaces an inline error and keeps the typed draft.
    await waitFor(() => expect(section.getByText(/Couldn’t save/i)).toBeInTheDocument());
    expect(input.value).toBe("5000");

    // Retry succeeds.
    fireEvent.click(section.getByRole("button", { name: /Save threshold/i }));
    await waitFor(() =>
      expect(mocks.updateCreditSpendingThreshold).toHaveBeenCalledTimes(2)
    );
  });

  it("keeps the previous value and shows an error when a clear fails", async () => {
    mocks.getSettings.mockResolvedValue(settings(15, 25000));
    mocks.updateCreditSpendingThreshold.mockRejectedValueOnce(new Error("nope"));
    const { container } = renderSettings();

    await screen.findByText("Credit card controls");
    const section = thresholdSection(container);
    const input = section.getByLabelText("Credit spending threshold amount") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("25000"));

    fireEvent.click(section.getByRole("button", { name: /^Clear$/i }));

    await waitFor(() => expect(section.getByText(/Couldn’t save/i)).toBeInTheDocument());
    // Previous value retained; no success message.
    expect(input.value).toBe("25000");
    expect(section.queryByText("Saved.")).not.toBeInTheDocument();
  });
});
