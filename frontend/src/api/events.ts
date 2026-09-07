import axios from "axios";
import client from "./client";

export type EventStatus = "planned" | "in_progress" | "completed" | "cancelled";
export interface EventSummaryDTO {
  item_count: number;
  expected_total: number;
  actual_total: number;
  missing_expected_count: number;
  missing_actual_count: number;
  budget_complete: boolean;
  actuals_complete: boolean;
  can_complete: boolean;
}
export interface EventItemInput {
  id?: string;
  name: string;
  expected_cost: number | null;
  actual_cost: number | null;
}
export interface EventItemDTO extends EventItemInput { id: string; position: number }
export interface PlannedEvent {
  id: string;
  name: string;
  note: string;
  target_date: string | null;
  status: EventStatus;
  suggestions_enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  summary: EventSummaryDTO;
}
export interface PlannedEventDetail extends PlannedEvent { items: EventItemDTO[] }
export interface EventInput {
  name: string;
  note: string;
  target_date: string | null;
  status: EventStatus;
  suggestions_enabled: boolean;
  items: EventItemInput[];
}
export interface EventUpdateInput extends EventInput { version: number }
export interface EventListParams { status?: EventStatus; limit?: number; offset?: number }
export interface EventPage {
  events: PlannedEvent[];
  limit: number;
  offset: number;
  has_more: boolean;
}
export interface EventSuggestionsPage extends EventPage {
  month: string;
  current_month: string;
  timezone: string;
  free_money: number | null;
}
export class EventsApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number, cause?: unknown) {
    super(message, { cause });
    this.name = "EventsApiError";
    this.status = status;
  }
}
function apiError(error: unknown): never {
  if (axios.isAxiosError(error)) {
    throw new EventsApiError(error.response?.data?.error ?? "Could not reach the server", error.response?.status, error);
  }
  throw error;
}
export const listEvents = (params: EventListParams, signal?: AbortSignal) =>
  client.get<EventPage>("/api/events", { params, signal }).then(r => r.data).catch(apiError);
export const getEvent = (id: string, signal?: AbortSignal) =>
  client.get<PlannedEventDetail>(`/api/events/${id}`, { signal }).then(r => r.data).catch(apiError);
export const createEvent = (body: EventInput) =>
  client.post<PlannedEventDetail>("/api/events", body).then(r => r.data).catch(apiError);
export const updateEvent = (id: string, body: EventUpdateInput) =>
  client.put<PlannedEventDetail>(`/api/events/${id}`, body).then(r => r.data).catch(apiError);
export const deleteEvent = (id: string, version: number) =>
  client.delete(`/api/events/${id}`, { headers: { "If-Match": `"${version}"` } }).then(() => undefined).catch(apiError);
export const duplicateEvent = (id: string, body: { name?: string; target_date?: string } = {}) =>
  client.post<PlannedEventDetail>(`/api/events/${id}/duplicate`, body).then(r => r.data).catch(apiError);
export const getEventSuggestions = (month: string, timezone: string, offset = 0, signal?: AbortSignal) =>
  client.get<EventSuggestionsPage>("/api/events/suggestions", { params: { month, timezone, limit: 5, offset }, signal }).then(r => r.data).catch(apiError);
