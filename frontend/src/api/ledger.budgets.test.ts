import { describe, expect, it, vi, beforeEach } from "vitest";
import client from "./client";
import { getMonthlyBudget, putMonthlyBudget } from "./ledger";

vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const mockedGet = vi.mocked(client.get);
const mockedPut = vi.mocked(client.put);

describe("monthly budget API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a month with GET /api/budgets/{month}", async () => {
    mockedGet.mockResolvedValue({
      data: { month: "2026-07", essential: 10000.25, flexible: 5000, daily: 15000.75 },
    });

    await expect(getMonthlyBudget("2026-07")).resolves.toEqual({
      month: "2026-07",
      essential: 10000.25,
      flexible: 5000,
      daily: 15000.75,
    });
    expect(mockedGet).toHaveBeenCalledWith("/api/budgets/2026-07");
  });

  it("saves only the three budget fields on PUT", async () => {
    mockedPut.mockResolvedValue({
      data: { month: "2026-07", essential: 12000.5, flexible: 6000, daily: 0 },
    });

    await expect(
      putMonthlyBudget("2026-07", { essential: 12000.5, flexible: 6000, daily: 0 })
    ).resolves.toEqual({
      month: "2026-07",
      essential: 12000.5,
      flexible: 6000,
      daily: 0,
    });
    expect(mockedPut).toHaveBeenCalledWith("/api/budgets/2026-07", {
      essential: 12000.5,
      flexible: 6000,
      daily: 0,
    });
  });
});
