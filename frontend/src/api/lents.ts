// Lent tracking API — isolated from transactions (see /api/lents).

import axios from "axios";
import client from "./client";
import type { Lent, LentInput, LentListStatus, LentRepayment, RepaymentInput } from "../types";

function unwrapApiError(e: unknown): never {
  if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object") {
    throw new Error((e.response.data as { error?: string }).error ?? "Request failed");
  }
  throw e;
}

export const listLents = (status: LentListStatus = "all") =>
  client.get<Lent[]>("/api/lents", { params: { status } }).then((r) => r.data);

export const getLent = (id: string) =>
  client.get<Lent>(`/api/lents/${id}`).then((r) => r.data);

export const createLent = (body: LentInput) =>
  client.post<Lent>("/api/lents", body).then((r) => r.data).catch(unwrapApiError);

export const updateLent = (id: string, body: LentInput) =>
  client.patch<Lent>(`/api/lents/${id}`, body).then((r) => r.data).catch(unwrapApiError);

export const deleteLent = (id: string) =>
  client.delete(`/api/lents/${id}`).then(() => undefined).catch(unwrapApiError);

export const listRepayments = (lentId: string) =>
  client.get<LentRepayment[]>(`/api/lents/${lentId}/repayments`).then((r) => r.data);

export const createRepayment = (lentId: string, body: RepaymentInput) =>
  client
    .post<LentRepayment>(`/api/lents/${lentId}/repayments`, body)
    .then((r) => r.data)
    .catch(unwrapApiError);

export const updateRepayment = (lentId: string, rid: string, body: RepaymentInput) =>
  client
    .patch<LentRepayment>(`/api/lents/${lentId}/repayments/${rid}`, body)
    .then((r) => r.data)
    .catch(unwrapApiError);

export const deleteRepayment = (lentId: string, rid: string) =>
  client
    .delete(`/api/lents/${lentId}/repayments/${rid}`)
    .then(() => undefined)
    .catch(unwrapApiError);
