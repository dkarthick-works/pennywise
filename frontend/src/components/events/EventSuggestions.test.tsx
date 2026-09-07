import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventSuggestions } from "./EventSuggestions";
import { getEventSuggestions } from "../../api/events";
import { eventFixture } from "../../test/eventFixture";
vi.mock("../../api/events", async original => ({ ...await original<typeof import("../../api/events")>(), getEventSuggestions: vi.fn() }));
function mount(month: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><EventSuggestions month={month} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 8, 15, 12)); });
afterEach(() => vi.useRealTimers());
describe("Event suggestions", () => {
  it("does not request historical or future months", () => {
    const view = mount("2026-08"); expect(screen.queryByRole("region")).not.toBeInTheDocument(); expect(getEventSuggestions).not.toHaveBeenCalled(); view.unmount();
    mount("2026-10"); expect(getEventSuggestions).not.toHaveBeenCalled();
  });
  it("renders backend candidates and independent links with calendar context", async () => {
    vi.mocked(getEventSuggestions).mockResolvedValue({ events: [eventFixture()], month: "2026-09", current_month: "2026-09", timezone: "UTC", free_money: 10000, limit: 5, offset: 0, has_more: false });
    mount("2026-09"); expect(await screen.findByText("Car service")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View event/ })).toHaveAttribute("href", "/events/event-1");
    expect(getEventSuggestions).toHaveBeenCalledWith("2026-09", expect.any(String), 0, expect.any(AbortSignal));
  });
  it.each([0, -100])("shows an empty state for free money %s", async free_money => {
    vi.mocked(getEventSuggestions).mockResolvedValue({ events: [], month: "2026-09", current_month: "2026-09", timezone: "UTC", free_money, limit: 5, offset: 0, has_more: false });
    mount("2026-09"); expect(await screen.findByText(/No event suggestions/)).toBeInTheDocument(); expect(screen.queryByRole("link", { name: /View event/ })).not.toBeInTheDocument();
  });
  it("hides old-month results on calendar change", async () => {
    vi.mocked(getEventSuggestions).mockResolvedValue({ events: [eventFixture()], month: "2026-09", current_month: "2026-09", timezone: "UTC", free_money: 10000, limit: 5, offset: 0, has_more: false });
    mount("2026-09"); await screen.findByText("Car service");
    act(() => { vi.setSystemTime(new Date(2026, 9, 1, 12)); fireEvent.focus(window); });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Event suggestions" })).not.toBeInTheDocument());
  });
});
