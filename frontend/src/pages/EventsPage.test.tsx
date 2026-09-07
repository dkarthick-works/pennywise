import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventsPage } from "./EventsPage";
import { listEvents } from "../api/events";
import { eventFixture } from "../test/eventFixture";
vi.mock("../api/events", async original => ({ ...await original<typeof import("../api/events")>(), listEvents: vi.fn() }));
function mount() { const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } }); return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/events"]}><EventsPage /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => vi.clearAllMocks());
describe("Events list", () => {
  it("shows empty state and separate create navigation", async () => {
    vi.mocked(listEvents).mockResolvedValue({ events: [], limit: 50, offset: 0, has_more: false }); mount();
    expect(await screen.findByText(/No events yet/)).toBeInTheDocument(); expect(screen.getByRole("link", { name: /Create your first/ })).toHaveAttribute("href", "/events/new");
  });
  it("renders server summaries, links, status filter, and next page", async () => {
    vi.mocked(listEvents).mockResolvedValue({ events: [eventFixture()], limit: 50, offset: 0, has_more: true }); mount();
    expect(await screen.findByRole("link", { name: "Car service" })).toHaveAttribute("href", "/events/event-1");
    expect(screen.getByText("Actuals incomplete · 1 missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2");
    expect(listEvents).toHaveBeenCalledWith({ status: undefined, limit: 50, offset: 50 }, expect.any(AbortSignal));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "planned" } }); await screen.findByText("Page 1");
    expect(listEvents).toHaveBeenCalledWith({ status: "planned", limit: 50, offset: 0 }, expect.any(AbortSignal));
  });
});
