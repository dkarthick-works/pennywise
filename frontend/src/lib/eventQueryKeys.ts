import type { EventListParams } from "../api/events";
export const eventKeys = {
  lists: ["events", "list"] as const,
  list: (params: EventListParams) => ["events", "list", params] as const,
  details: ["events", "detail"] as const,
  detail: (id: string) => ["events", "detail", id] as const,
  suggestions: ["event-suggestions"] as const,
  suggestionPage: (month: string, timezone: string, offset: number) => ["event-suggestions", month, timezone, 5, offset] as const,
};
