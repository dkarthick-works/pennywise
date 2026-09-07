import type { EventInput, EventStatus, EventUpdateInput, PlannedEventDetail } from "../api/events";

export const eventStatuses: EventStatus[] = ["planned", "in_progress", "completed", "cancelled"];
export const eventStatusLabel: Record<EventStatus, string> = {
  planned: "Planned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};
export interface EventItemDraft { key: string; id?: string; name: string; expected: string; actual: string }
export interface EventDraft { name: string; note: string; date: string; status: EventStatus; suggestions: boolean; items: EventItemDraft[] }
export const newEventItem = (): EventItemDraft => ({ key: crypto.randomUUID(), name: "", expected: "", actual: "" });
export function eventDraft(event?: PlannedEventDetail): EventDraft {
  if (!event) return { name: "", note: "", date: "", status: "planned", suggestions: true, items: [] };
  return {
    name: event.name, note: event.note, date: event.target_date ?? "", status: event.status, suggestions: event.suggestions_enabled,
    items: event.items.map(i => ({ key: i.id, id: i.id, name: i.name, expected: i.expected_cost === null ? "" : String(i.expected_cost), actual: i.actual_cost === null ? "" : String(i.actual_cost) })),
  };
}
export function eventAmount(text: string): number | null {
  if (!text.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) throw new Error("Costs must be nonnegative numbers with at most two decimal places.");
  const n = Number(text);
  if (!Number.isFinite(n) || n > 999999999999.99) throw new Error("Cost exceeds the maximum of ₹999999999999.99.");
  return n;
}
export function serializeEvent(draft: EventDraft): EventInput {
  const name = draft.name.trim();
  if (!name || [...name].length > 200) throw new Error("Event name must contain 1–200 characters.");
  if ([...draft.note].length > 5000) throw new Error("Note must be at most 5,000 characters.");
  if (draft.items.length > 500) throw new Error("An event can contain at most 500 items.");
  return {
    name, note: draft.note, target_date: draft.date || null, status: draft.status, suggestions_enabled: draft.suggestions,
    items: draft.items.map((i, index) => {
      const itemName = i.name.trim();
      if (!itemName || [...itemName].length > 200) throw new Error(`Item ${index + 1} needs a name of 1–200 characters. Remove the row if it is not needed.`);
      return { ...(i.id ? { id: i.id } : {}), name: itemName, expected_cost: eventAmount(i.expected), actual_cost: eventAmount(i.actual) };
    }),
  };
}
// Status actions use the same complete payload shape as edits; never PATCH or send response-only fields.
export function savedEventInput(event: PlannedEventDetail, status = event.status): EventUpdateInput {
  return { ...serializeEvent({ ...eventDraft(event), status }), version: event.version };
}
export function eventBudgetSnapshot(expected: number, actual: number) {
  const remaining = expected - actual;
  if (expected <= 0) return { remaining, usedPct: null as number | null, savedPct: null as number | null, overPct: null as number | null, barPct: 0 };
  const usedPct = Math.round((actual / expected) * 100);
  const savedPct = remaining > 0 ? Math.round((remaining / expected) * 100) : remaining === 0 ? 0 : null;
  const overPct = remaining < 0 ? Math.round((-remaining / expected) * 100) : null;
  return { remaining, usedPct, savedPct, overPct, barPct: Math.min(100, (actual / expected) * 100) };
}
export function eventsReturnPath(state: unknown): string {
  if (state && typeof state === "object" && "eventsReturn" in state && typeof state.eventsReturn === "string" && /^\/events(?:\?[^#]*)?$/.test(state.eventsReturn)) return state.eventsReturn;
  return "/events";
}
