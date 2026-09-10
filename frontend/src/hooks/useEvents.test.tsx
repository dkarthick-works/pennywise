import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api/events";
import { useEventMutations } from "./useEvents";
import { useSaveMonthlyBudget } from "./useMonthlyBudget";
import { putMonthlyBudget } from "../api/ledger";
import { savedEventInput } from "../lib/events";
import { eventKeys } from "../lib/eventQueryKeys";
import { eventFixture } from "../test/eventFixture";
vi.mock("../api/events", async original => ({ ...await original<typeof import("../api/events")>(), createEvent: vi.fn(), updateEvent: vi.fn(), duplicateEvent: vi.fn(), deleteEvent: vi.fn() }));
vi.mock("../api/ledger", async original => ({ ...await original<typeof import("../api/ledger")>(), putMonthlyBudget: vi.fn() }));
function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}
beforeEach(() => vi.clearAllMocks());
describe("event mutation caches", () => {
  it("updates event caches and suggestions, not financial caches", async () => {
    const { qc, wrapper } = setup(); const spy = vi.spyOn(qc, "invalidateQueries");
    const event = eventFixture(); vi.mocked(api.updateEvent).mockResolvedValue(event);
    const { result } = renderHook(useEventMutations, { wrapper });
    await act(async () => { await result.current.update.mutateAsync({ id: event.id, body: savedEventInput(event) }); });
    expect(qc.getQueryData(eventKeys.detail(event.id))).toEqual(event);
    expect(spy.mock.calls.map(c => c[0]?.queryKey)).toEqual([eventKeys.lists, eventKeys.suggestions]);
  });
  it("removes deleted details and preserves quoted-version input", async () => {
    const { qc, wrapper } = setup(); const event = eventFixture(); qc.setQueryData(eventKeys.detail(event.id), event);
    vi.mocked(api.deleteEvent).mockResolvedValue(undefined);
    const { result } = renderHook(useEventMutations, { wrapper });
    await act(async () => { await result.current.remove.mutateAsync({ id: event.id, version: 1 }); });
    expect(api.deleteEvent).toHaveBeenCalledWith(event.id, 1); expect(qc.getQueryData(eventKeys.detail(event.id))).toBeUndefined();
  });
  it("invalidates transaction caches when deleting linked transaction", async () => {
    const { qc, wrapper } = setup(); const event = eventFixture({ converted_transaction_id: "txn-1" });
    const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(api.deleteEvent).mockResolvedValue(undefined);
    const { result } = renderHook(useEventMutations, { wrapper });
    await act(async () => { await result.current.remove.mutateAsync({ id: event.id, version: 2, deleteTransaction: true }); });
    expect(api.deleteEvent).toHaveBeenCalledWith(event.id, 2, true);
    const keys = spy.mock.calls.map(c => c[0]?.queryKey);
    expect(keys).toContainEqual(eventKeys.lists);
    expect(keys).toContainEqual(["txns"]);
    expect(keys).toContainEqual(["dashboard"]);
  });
  it("budget changes invalidate event suggestions", async () => {
    const { qc, wrapper } = setup(); const spy = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(putMonthlyBudget).mockResolvedValue({ month: "2026-09", essential: 1, flexible: 2, daily: 3 });
    const { result } = renderHook(useSaveMonthlyBudget, { wrapper });
    await act(async () => { await result.current.mutateAsync({ month: "2026-09", budgets: { essential: 1, flexible: 2, daily: 3 } }); });
    expect(spy).toHaveBeenCalledWith({ queryKey: eventKeys.suggestions });
  });
});
