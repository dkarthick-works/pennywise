import { describe, it, expect, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateCreditCaches, invalidateMonthCaches } from "./monthCaches";

describe("credit cache invalidation", () => {
  it("invalidateCreditCaches targets both credit prefixes across all months/views", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    invalidateCreditCaches(qc);

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(["dashboard", "credit-usage"]);
    expect(keys).toContainEqual(["dashboard", "credit-transactions"]);
  });

  it("invalidateMonthCaches also busts the credit prefixes (cross-month cycles)", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    invalidateMonthCaches(qc, "2026-07");

    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    // Month-specific keys.
    expect(keys).toContain(JSON.stringify(["txns", "month", "2026-07"]));
    expect(keys).toContain(JSON.stringify(["dashboard", "monthly", "2026-07"]));
    // Credit prefixes (no month) so adjacent statement cycles refresh too.
    expect(keys).toContain(JSON.stringify(["dashboard", "credit-usage"]));
    expect(keys).toContain(JSON.stringify(["dashboard", "credit-transactions"]));
  });
});
