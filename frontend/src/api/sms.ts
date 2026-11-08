import client from "./client";
import type { Section, Transaction } from "../types";

export interface SMSDevice {
  id: string;
  label: string;
  enabled: boolean;
  revoked_at: string | null;
  last_upload_at: string | null;
  last_scan_end: number | null;
}
export async function listSMSDevices(): Promise<SMSDevice[]> {
  return (await client.get<SMSDevice[]>("/api/sms/devices")).data;
}
export async function createSMSDevice(label: string): Promise<{ device: SMSDevice; token: string }> {
  return (await client.post("/api/sms/devices", { label })).data;
}
export async function revokeSMSDevice(id: string): Promise<void> {
  await client.delete(`/api/sms/devices/${encodeURIComponent(id)}`);
}

export interface SMSDraft {
  id: string;
  source_sms_id: string;
  revision: number;
  section: Section | null;
  category: string;
  amount: number;
  date: string;
  kind: "cash" | "credit";
  currency: string;
  direction: string;
  event_type: string;
  warnings: string[];
  possible_duplicate: boolean;
}
export interface SMSDraftValues {
  section: Section | "";
  category: string;
  amount: string;
  date: string;
  kind: "cash" | "credit";
}
export interface SMSJob {
  id: string;
  status: string;
  failed_stage: string;
  error_code: string;
  verification_attempts: number;
  extraction_attempts: number;
}
export async function listSMSDrafts(offset = 0): Promise<{ drafts: SMSDraft[]; next_offset: number | null }> {
  return (await client.get("/api/sms/drafts", { params: { offset } })).data;
}
export async function listFailedSMSJobs(offset = 0): Promise<SMSJob[]> {
  return (await client.get("/api/sms/jobs", { params: { status: "failed", offset } })).data;
}
export async function saveSMSDraft(draft: SMSDraft, values: SMSDraftValues): Promise<void> {
  await client.put(`/api/sms/drafts/${draft.id}`, { ...values, amount: Number(values.amount), revision: draft.revision });
}
export async function approveSMSDraft(draft: SMSDraft, values: SMSDraftValues): Promise<Transaction> {
  return (await client.post<Transaction>("/api/transactions", {
    ...values, amount: Number(values.amount), sms_draft_id: draft.id, sms_draft_revision: draft.revision,
  })).data;
}
export async function ignoreSMSDraft(draft: SMSDraft): Promise<void> {
  await client.post(`/api/sms/drafts/${draft.id}/ignore`, { revision: draft.revision });
}
export async function retrySMSJob(id: string): Promise<void> {
  await client.post(`/api/sms/jobs/${id}/retry`);
}
