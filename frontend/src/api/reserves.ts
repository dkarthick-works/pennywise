import axios from "axios";
import client from "./client";
import type { IncomeActivityItem, Reserve, ReserveDepositInput, ReserveInput, ReserveOperation, ReserveSpendingInput, ReserveTransferInput } from "../types";

export const reserveKeys = {
  all: ["reserves"] as const,
  list: (includeArchived = false) => ["reserves", "list", { includeArchived }] as const,
  operations: (year: number, reserveId?: string) => ["reserves", "operations", year, reserveId ?? "all"] as const,
  operationsForYear: (year: number) => ["reserves", "operations", year] as const,
  incomeActivity: (month: string) => ["reserves", "income-activity", month] as const,
};

function unwrapReserveError(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.data && typeof error.response.data === "object") {
    throw new Error((error.response.data as { error?: string }).error ?? "Request failed", { cause: error });
  }
  throw error;
}

export const listReserves = (includeArchived = false, signal?: AbortSignal) =>
  client.get<Reserve[]>("/api/reserves", { params: { include_archived: includeArchived }, signal }).then((response) => response.data);

export const createReserve = (body: ReserveInput) =>
  client.post<Reserve>("/api/reserves", body).then((response) => response.data).catch(unwrapReserveError);

export const renameReserve = (id: string, body: ReserveInput) =>
  client.patch<Reserve>(`/api/reserves/${id}`, body).then((response) => response.data).catch(unwrapReserveError);

export const listReserveOperations = (year: number, reserveId?: string, signal?: AbortSignal) =>
  client.get<ReserveOperation[]>("/api/reserve-operations", { params: { year, ...(reserveId ? { reserve_id: reserveId } : {}) }, signal }).then((response) => response.data);

export const createReserveDeposit = (body: ReserveDepositInput) =>
  client.post<ReserveOperation>("/api/reserve-operations/deposits", body).then((response) => response.data).catch(unwrapReserveError);

export const createReserveSpending = (body: ReserveSpendingInput) =>
  client.post<ReserveOperation>("/api/reserve-operations/spending", body).then((response) => response.data).catch(unwrapReserveError);

export const createReserveTransfer = (body: ReserveTransferInput) =>
  client.post<ReserveOperation>("/api/reserve-operations/transfers", body).then((response) => response.data).catch(unwrapReserveError);

export const deleteReserveTransfer = (id: string) =>
  client.delete(`/api/reserve-transfers/${id}`).then(() => undefined).catch(unwrapReserveError);

export const updateReserveSpending = (id: string, body: ReserveSpendingInput) =>
  client.patch<ReserveOperation>(`/api/reserve-operations/${id}`, body).then((response) => response.data).catch(unwrapReserveError);

export const deleteReserveSpending = (id: string) =>
  client.delete(`/api/reserve-operations/${id}`).then(() => undefined).catch(unwrapReserveError);

export const archiveReserve = (id: string) =>
  client.post(`/api/reserves/${id}/archive`).then(() => undefined).catch(unwrapReserveError);

export const deleteReserve = (id: string) =>
  client.delete(`/api/reserves/${id}`).then(() => undefined).catch(unwrapReserveError);

export const getIncomeActivity = (month: string, signal?: AbortSignal) =>
  client.get<IncomeActivityItem[]>("/api/income-activity", { params: { month }, signal }).then((response) => response.data);
