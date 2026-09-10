import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { convertEvent, createEvent, deleteEvent, duplicateEvent, EventsApiError, getEvent, listEvents, updateEvent } from "../api/events";
import type { EventListParams, EventUpdateInput, PlannedEventDetail } from "../api/events";
import { eventKeys } from "../lib/eventQueryKeys";
import { invalidateAllTransactionCaches, invalidateEventCaches, invalidateMonthCaches } from "../lib/monthCaches";
import { monthKey } from "../lib/dates";

export const retryEventRead = (count: number, error: unknown) => !(error instanceof EventsApiError && error.status === 404) && count < 2;
export function useEvent(id: string) {
  return useQuery({ queryKey: eventKeys.detail(id), queryFn: ({ signal }) => getEvent(id, signal), enabled: !!id, retry: retryEventRead });
}
export function useEventList(params: EventListParams) {
  return useQuery({ queryKey: eventKeys.list(params), queryFn: ({ signal }) => listEvents(params, signal), retry: retryEventRead });
}
export function useEventMutations() {
  const qc = useQueryClient();
  async function invalidate() {
    await Promise.all([qc.invalidateQueries({ queryKey: eventKeys.lists }), qc.invalidateQueries({ queryKey: eventKeys.suggestions })]);
  }
  async function saved(event: PlannedEventDetail) {
    await qc.cancelQueries({ queryKey: eventKeys.detail(event.id) });
    qc.setQueryData(eventKeys.detail(event.id), event);
    await invalidate();
  }
  const create = useMutation({ mutationFn: createEvent, retry: false, onSuccess: saved });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: EventUpdateInput }) => updateEvent(id, body), retry: false, onSuccess: saved });
  const duplicate = useMutation({ mutationFn: ({ id, name, target_date }: { id: string; name?: string; target_date?: string }) => duplicateEvent(id, { ...(name ? { name } : {}), ...(target_date ? { target_date } : {}) }), retry: false, onSuccess: saved });
  const convert = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { version: number; date: string; section: "essential" | "flexible" | "daily" } }) => convertEvent(id, body),
    retry: false,
    onSuccess: async (event) => {
      await saved(event);
      invalidateMonthCaches(qc, monthKey(event.target_date ?? new Date().toISOString().slice(0, 10)));
    },
  });
  const remove = useMutation({ mutationFn: ({ id, version, deleteTransaction }: { id: string; version: number; deleteTransaction?: boolean }) => deleteTransaction === undefined ? deleteEvent(id, version) : deleteEvent(id, version, deleteTransaction), retry: false, onSuccess: async (_, { id, deleteTransaction }) => {
    await qc.cancelQueries({ queryKey: eventKeys.detail(id) });
    qc.removeQueries({ queryKey: eventKeys.detail(id) });
    invalidateEventCaches(qc);
    if (deleteTransaction) invalidateAllTransactionCaches(qc);
  } });
  return { create, update, duplicate, convert, remove };
}
