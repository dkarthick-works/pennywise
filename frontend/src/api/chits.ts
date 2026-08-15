// Chit funds API — isolated from ledger transactions (see /api/chits).

import axios from "axios";
import client from "./client";
import { parseContentDisposition } from "../lib/export";
import type {
  ChitDetail,
  ChitInput,
  ChitInstallment,
  ChitInstallmentInput,
  ChitSummary,
  ChitTransferImportResult,
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

export async function exportChits(chitId?: string): Promise<{ blob: Blob; filename: string }> {
  try {
    const response = await client.get<Blob>("/api/chits/export", {
      params: chitId ? { chit_id: chitId } : undefined,
      responseType: "blob",
    });
    return {
      blob: response.data,
      filename:
        parseContentDisposition(response.headers["content-disposition"]) ??
        (chitId ? `pennywise-chit-${chitId}.json` : "pennywise-chits.json"),
    };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
      const text = await e.response.data.text();
      let message = "Export failed";
      try {
        const body = JSON.parse(text) as { error?: string };
        message = body.error ?? message;
      } catch {
        // Keep the UI readable if the server returns a non-JSON error.
      }
      throw new Error(message, { cause: e });
    }
    throw e;
  }
}

export async function importChits(rawArchiveText: string): Promise<ChitTransferImportResult> {
  try {
    const response = await client.post<ChitTransferImportResult>(
      "/api/chits/import",
      rawArchiveText,
      { headers: { "Content-Type": "application/json" } },
    );
    return response.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data && typeof e.response.data === "object") {
      const body = e.response.data as { error?: string };
      throw new Error(body.error ?? "Import failed", { cause: e });
    }
    throw e;
  }
}
