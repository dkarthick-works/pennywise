import { beforeEach, describe, expect, it, vi } from "vitest";
import client from "./client";
import { createEvent, deleteEvent, duplicateEvent, getEvent, getEventSuggestions, listEvents, updateEvent } from "./events";
import { eventFixture } from "../test/eventFixture";
import { savedEventInput } from "../lib/events";
vi.mock("./client", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); });
describe("Events API", () => {
  it("uses paginated listing and signal-aware details", async () => {
    vi.mocked(client.get).mockResolvedValue({ data: {} });
    await listEvents({ status: "planned", limit: 50, offset: 50 });
    expect(client.get).toHaveBeenCalledWith("/api/events", { params: { status: "planned", limit: 50, offset: 50 }, signal: undefined });
    const signal = new AbortController().signal; await getEvent("id", signal);
    expect(client.get).toHaveBeenLastCalledWith("/api/events/id", { signal });
  });
  it("sends a whole PUT and quoted If-Match on deletion", async () => {
    vi.mocked(client.put).mockResolvedValue({ data: eventFixture() }); vi.mocked(client.delete).mockResolvedValue({});
    const body = savedEventInput(eventFixture()); await updateEvent("event-1", body);
    expect(client.put).toHaveBeenCalledWith("/api/events/event-1", body);
    await deleteEvent("event-1", 3); expect(client.delete).toHaveBeenCalledWith("/api/events/event-1", { headers: { "If-Match": '"3"' } });
  });
  it("creates and duplicates without inventing client-side copied records", async () => {
    vi.mocked(client.post).mockResolvedValue({ data: eventFixture() });
    await createEvent(savedEventInput(eventFixture()));
    await duplicateEvent("event-1"); expect(client.post).toHaveBeenLastCalledWith("/api/events/event-1/duplicate", {});
  });
  it("preserves HTTP status and backend error message", async () => {
    vi.mocked(client.put).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { error: "event changed" } } });
    await expect(updateEvent("id", savedEventInput(eventFixture()))).rejects.toMatchObject({ status: 409, message: "event changed" });
  });
  it("passes current-month calendar context and bounded pagination", async () => {
    vi.mocked(client.get).mockResolvedValue({ data: {} });
    await getEventSuggestions("2026-09", "Asia/Kolkata", 5);
    expect(client.get).toHaveBeenCalledWith("/api/events/suggestions", { params: { month: "2026-09", timezone: "Asia/Kolkata", limit: 5, offset: 5 }, signal: undefined });
  });
});
