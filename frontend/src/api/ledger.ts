// All Pennywise API calls. Every function returns the unwrapped data so callers
// can pass them directly into React Query queryFn / mutationFn.

import axios from "axios";
import client from "./client";
import { parseContentDisposition } from "../lib/export";
import type {
  Transaction,
  Settings,
  Budgets,
  Templates,
  Profile,
  MonthState,
  OpenMonthResponse,
  Insights,
  DashboardMonthly,
  CategoryGroupSpend,
  CategoryGroup,
  CategoryMapping,
} from "../types";

// ─── Profile ─────────────────────────────────────────────────────────────

export const getProfile = () =>
  client.get<Profile>("/api/profile").then((r) => r.data);

export const updateProfile = (body: { display_name: string; email: string }) =>
  client.put<Profile>("/api/profile", body).then((r) => r.data);

// ─── Settings ─────────────────────────────────────────────────────────────

export const getSettings = () =>
  client.get<Settings>("/api/settings").then((r) => r.data);

export const updateBudgets = (budgets: Budgets) =>
  client.put<Settings>("/api/settings/budgets", budgets).then((r) => r.data);

export const updatePreferences = (body: { currency: string; theme: string }) =>
  client.put<Settings>("/api/settings/preferences", body).then((r) => r.data);

// ─── Templates ────────────────────────────────────────────────────────────

export const getTemplates = () =>
  client.get<Templates>("/api/templates").then((r) => r.data);

export const putTemplates = (section: "essential" | "flexible", labels: string[]) =>
  client.put<Templates>(`/api/templates/${section}`, { labels }).then((r) => r.data);

// ─── Transactions ─────────────────────────────────────────────────────────

export const getTxnsByMonth = (month: string) =>
  client.get<Transaction[]>("/api/transactions", { params: { month } }).then((r) => r.data);

export const getTxnsByYear = (year: string) =>
  client.get<Transaction[]>("/api/transactions", { params: { year } }).then((r) => r.data);

export async function exportTransactions(
  from: string,
  to: string
): Promise<{ blob: Blob; filename: string }> {
  try {
    const r = await client.get<Blob>("/api/transactions/export", {
      params: { from, to },
      responseType: "blob",
    });
    return {
      blob: r.data,
      filename:
        parseContentDisposition(r.headers["content-disposition"]) ??
        `pennywise-transactions-${from}_${to}.csv`,
    };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
      const text = await e.response.data.text();
      let message = "Export failed";
      try {
        const body = JSON.parse(text) as { error?: string };
        message = body.error ?? message;
      } catch {
        // The backend normally returns JSON errors, but keep the UI readable if not.
      }
      throw new Error(message);
    }
    throw e;
  }
}

export const createTxn = (body: Omit<Transaction, "id" | "settled">) =>
  client.post<Transaction>("/api/transactions", body).then((r) => r.data);

export const updateTxn = (id: string, patch: Partial<Omit<Transaction, "id">>) =>
  client.patch<Transaction>(`/api/transactions/${id}`, patch).then((r) => r.data);

export const deleteTxn = (id: string) =>
  client.delete(`/api/transactions/${id}`);

// ─── Open credits picker (settlement cell) ────────────────────────────────

export const getOpenCredits = (section: string, excludeId?: string) =>
  client
    .get<Transaction[]>(`/api/sections/${section}/open-credits`, {
      params: excludeId ? { exclude: excludeId } : {},
    })
    .then((r) => r.data);

// ─── Autocomplete suggestions ─────────────────────────────────────────────

export const getDailySuggestions = () =>
  client.get<string[]>("/api/daily-suggestions").then((r) => r.data);

export const getIncomeSuggestions = () =>
  client.get<string[]>("/api/income-suggestions").then((r) => r.data);

// ─── Insights ─────────────────────────────────────────────────────────────

export const getInsights = () =>
  client.get<Insights>("/api/insights").then((r) => r.data);

// ─── Dashboard ─────────────────────────────────────────────────────────────

export const getDashboardMonthly = (month: string) =>
  client.get<DashboardMonthly>("/api/dashboard/monthly", { params: { month } }).then((r) => r.data);

export const getGroupSpend = (month: string): Promise<CategoryGroupSpend[]> =>
  client.get<CategoryGroupSpend[]>("/api/dashboard/group-spend", { params: { month } }).then((r) => r.data);

// ─── Month state ──────────────────────────────────────────────────────────

export const getMonthState = (month: string) =>
  client.get<MonthState>(`/api/months/${month}`).then((r) => r.data);

export const setMonthClosed = (month: string, closed: boolean) =>
  client.put<MonthState>(`/api/months/${month}/closed`, { closed }).then((r) => r.data);

export const openMonth = (month: string) =>
  client.post<OpenMonthResponse>(`/api/months/${month}/open`).then((r) => r.data);

// ─── Category grouping ──────────────────────────────────────────────────────

export const getUnmappedCategories = () =>
  client.get<string[]>("/api/categories/unmapped").then((r) => r.data);

export const getCategoryGroups = () =>
  client.get<CategoryGroup[]>("/api/category-groups").then((r) => r.data);

export const createCategoryGroup = (body: { name: string }) =>
  client.post<CategoryGroup>("/api/category-groups", body).then((r) => r.data);

export const updateCategoryGroup = (id: string, body: { name: string }) =>
  client.patch<CategoryGroup>(`/api/category-groups/${id}`, body).then((r) => r.data);

export const deleteCategoryGroup = (id: string) =>
  client.delete(`/api/category-groups/${id}`);

export const getCategoryMappings = () =>
  client.get<CategoryMapping[]>("/api/category-mappings").then((r) => r.data);

export const getTransactionCategoryTexts = (params: { q?: string; excludeGroupId?: string }) =>
  client
    .get<string[]>("/api/categories/texts", {
      params: { q: params.q, exclude_group_id: params.excludeGroupId },
    })
    .then((r) => r.data);

export const createCategoryMapping = (body: {
  raw_category: string;
  group_id?: string;
  group_name?: string;
}) => client.post<CategoryMapping>("/api/category-mappings", body).then((r) => r.data);

export const deleteCategoryMapping = (id: string) =>
  client.delete(`/api/category-mappings/${id}`);
