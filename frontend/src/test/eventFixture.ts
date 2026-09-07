import type { PlannedEventDetail } from "../api/events";
export function eventFixture(overrides: Partial<PlannedEventDetail> = {}): PlannedEventDetail {
  return {
    id: "event-1", name: "Car service", note: "", target_date: null, status: "planned", suggestions_enabled: true, version: 1,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    items: [{ id: "item-1", name: "Service bill", expected_cost: 8000.25, actual_cost: null, position: 0 }],
    summary: { item_count: 1, expected_total: 8000.25, actual_total: 0, missing_expected_count: 0, missing_actual_count: 1, budget_complete: true, actuals_complete: false, can_complete: false },
    ...overrides,
  };
}
