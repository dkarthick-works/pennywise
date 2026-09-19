import axios from "axios";
import client from "./client";
import type { IncomeActivityItem, Reserve, ReserveDepositInput, ReserveInput, ReserveOperation } from "../types";

export const reserveKeys = {
  all: ["reserves"] as const,
  list: (includeArchived = false) => ["reserves", "list", { includeArchived }] as const,
  operations: (year: number, reserveId?: string) => ["reserves", "operations", year, reserveId ?? "all"] as const,
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

export const getIncomeActivity = (month: string, signal?: AbortSignal) =>
  client.get<IncomeActivityItem[]>("/api/income-activity", { params: { month }, signal }).then((response) => response.data);
