import { describe, expect, it } from "vitest";
import { eventFixture } from "../test/eventFixture";
import { eventAmount, eventDraft, eventsReturnPath, newEventItem, savedEventInput, serializeEvent } from "./events";

describe("event form serialization", () => {
  it("defaults to a planned empty event with suggestions enabled", () => {
    expect(eventDraft()).toEqual({ name: "", note: "", date: "", status: "planned", suggestions: true, items: [] });
    expect(serializeEvent({ ...eventDraft(), name: " Service " })).toEqual({ name: "Service", note: "", target_date: null, status: "planned", suggestions_enabled: true, items: [] });
  });
  it("distinguishes empty and explicit zero without rounding paise", () => {
    expect(eventAmount("")).toBeNull(); expect(eventAmount("0")).toBe(0); expect(eventAmount("123.45")).toBe(123.45);
    const draft = eventDraft(eventFixture());
    expect(draft.items[0].actual).toBe("");
    expect(serializeEvent(draft).items[0]).toMatchObject({ actual_cost: null, expected_cost: 8000.25 });
    draft.items[0].actual = "0";
    expect(serializeEvent(draft).items[0].actual_cost).toBe(0);
  });
  it.each(["-1", "1.234", "1abc", "₹30", "NaN", "Infinity", "1e2", "1,200", "1000000000000"])("rejects malformed cost %s", text => {
    expect(() => eventAmount(text)).toThrow();
  });
  it("retains existing IDs and versions, clears date, and excludes response-only fields", () => {
    const event = eventFixture({ target_date: "2026-10-01", version: 5 });
    const draft = eventDraft(event); draft.date = ""; draft.items.unshift({ ...newEventItem(), name: "New", expected: "0", actual: "" });
    const body = serializeEvent(draft);
    expect(body.target_date).toBeNull(); expect(body.items[0]).not.toHaveProperty("id"); expect(body.items[1].id).toBe("item-1");
    expect(body).not.toHaveProperty("summary"); expect(body.items[1]).not.toHaveProperty("position");
    expect(savedEventInput(event, "in_progress")).toMatchObject({ version: 5, status: "in_progress" });
  });
  it("rejects unnamed rows rather than silently removing them", () => {
    expect(() => serializeEvent({ ...eventDraft(), name: "Plan", items: [newEventItem()] })).toThrow(/Item 1/);
    expect(() => serializeEvent({ ...eventDraft(), name: "x".repeat(201) })).toThrow();
    expect(() => serializeEvent({ ...eventDraft(), name: "x", note: "x".repeat(5001) })).toThrow();
  });
  it("allows explicit reopen and zero actuals; backend owns completion validation", () => {
    const event = eventFixture({ status: "completed" });
    const body = savedEventInput(event, "planned");
    expect(body.status).toBe("planned"); expect(body.items[0].actual_cost).toBeNull();
  });
  it("restricts return destinations to the Events list", () => {
    expect(eventsReturnPath({ eventsReturn: "/events?status=planned&offset=50" })).toBe("/events?status=planned&offset=50");
    for (const path of ["https://evil.test", "//evil.test", "/events/123", "/record"]) expect(eventsReturnPath({ eventsReturn: path })).toBe("/events");
  });
});
