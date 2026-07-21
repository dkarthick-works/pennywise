// Chit funds API — isolated from ledger transactions (see /api/chits).

import axios from "axios";
import client from "./client";
import type {
  ChitDetail,
  ChitInput,
  ChitInstallment,
  ChitInstallmentInput,
  ChitSummary,
} from "../types";

function unwrapApiError(e: unknown): never {
  if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object") {
    throw new Error((e.response.data as { error?: string }).error ?? "Request failed");
  }
  throw e;
}

export const listChits = () =>
  client.get<ChitSummary[]>("/api/chits").then((r) => r.data);

export const getChit = (id: string) =>
  client.get<ChitDetail>(`/api/chits/${id}`).then((r) => r.data);

export const createChit = (body: ChitInput) =>
  client.post<ChitSummary>("/api/chits", body).then((r) => r.data).catch(unwrapApiError);

export const updateChit = (id: string, body: ChitInput) =>
  client.patch<ChitSummary>(`/api/chits/${id}`, body).then((r) => r.data).catch(unwrapApiError);

export const deleteChit = (id: string) =>
  client.delete(`/api/chits/${id}`).then(() => undefined).catch(unwrapApiError);

export const createChitInstallment = (chitId: string, body: ChitInstallmentInput) =>
  client
    .post<ChitInstallment>(`/api/chits/${chitId}/installments`, body)
    .then((r) => r.data)
    .catch(unwrapApiError);

export const updateChitInstallment = (
  chitId: string,
  installmentId: string,
  body: ChitInstallmentInput,
) =>
  client
    .patch<ChitInstallment>(`/api/chits/${chitId}/installments/${installmentId}`, body)
    .then((r) => r.data)
    .catch(unwrapApiError);

export const deleteChitInstallment = (chitId: string, installmentId: string) =>
  client
    .delete(`/api/chits/${chitId}/installments/${installmentId}`)
    .then(() => undefined)
    .catch(unwrapApiError);
