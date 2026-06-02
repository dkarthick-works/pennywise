// All Pennywise API calls. Every function returns the unwrapped data so callers
// can pass them directly into React Query queryFn / mutationFn.

import client from "./client";
import type {
  Transaction,
  Settings,
  Budgets,
  Templates,
  Profile,
  MonthState,
  OpenMonthResponse,
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

// ─── Month state ──────────────────────────────────────────────────────────

export const getMonthState = (month: string) =>
  client.get<MonthState>(`/api/months/${month}`).then((r) => r.data);

export const setMonthClosed = (month: string, closed: boolean) =>
  client.put<MonthState>(`/api/months/${month}/closed`, { closed }).then((r) => r.data);

export const openMonth = (month: string) =>
  client.post<OpenMonthResponse>(`/api/months/${month}/open`).then((r) => r.data);
