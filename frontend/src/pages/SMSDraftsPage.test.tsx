import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AxiosError } from "axios";
import { SMSDraftsPage } from "./SMSDraftsPage";
import { approveSMSDraft, ignoreSMSDraft, listFailedSMSJobs, listSMSDrafts, retrySMSJob, saveSMSDraft, type SMSDraft } from "../api/sms";
vi.mock("../api/sms", () => ({ approveSMSDraft: vi.fn(), ignoreSMSDraft: vi.fn(), listFailedSMSJobs: vi.fn(), listSMSDrafts: vi.fn(), retrySMSJob: vi.fn(), saveSMSDraft: vi.fn() }));
const draft: SMSDraft = { id: "draft-1", source_sms_id: "source-1", revision: 1, category: "SHOP", amount: 125.5, date: "2026-04-15", section: null, kind: "cash", currency: "INR", direction: "debit", event_type: "settlement", warnings: ["possible_settlement_review", "cash_defaulted"], possible_duplicate: true };
function show() {
 const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
 render(<QueryClientProvider client={qc}><MemoryRouter><SMSDraftsPage /></MemoryRouter></QueryClientProvider>);
 return qc;
}
beforeEach(() => {
 vi.resetAllMocks();
 vi.mocked(listSMSDrafts).mockResolvedValue({ drafts: [draft], next_offset: null });
 vi.mocked(listFailedSMSJobs).mockResolvedValue([]);
});
describe("SMS draft review", () => {
 it("requires a section and approves edited values, invalidating ledger caches", async () => {
  vi.mocked(approveSMSDraft).mockResolvedValue({ id: "txn", section: "daily", category: "Groceries", amount: 150, date: draft.date, kind: "cash" });
  const qc = show();
  const invalidation = vi.spyOn(qc, "invalidateQueries");
  const approve = await screen.findByRole("button", { name: "Approve and save Transaction" });
  expect(screen.getByText(/Possible card bill payment/)).toBeInTheDocument();
  expect(screen.getByText(/Possible duplicate/)).toBeInTheDocument();
  fireEvent.click(approve);
  expect(await screen.findByRole("alert")).toHaveTextContent("Choose a section");
  expect(approveSMSDraft).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Section"), { target: { value: "daily" } });
  fireEvent.change(screen.getByLabelText("Transaction name"), { target: { value: "Groceries" } });
  fireEvent.change(screen.getByLabelText("Amount (INR)"), { target: { value: "150" } });
  vi.mocked(listSMSDrafts).mockResolvedValue({ drafts: [], next_offset: null });
  fireEvent.click(approve);
  await waitFor(() => expect(approveSMSDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ section: "daily", category: "Groceries", amount: "150" })));
  expect(await screen.findByText("Transaction saved to your ledger.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByLabelText("Transaction name")).not.toBeInTheDocument());
  expect(invalidation).toHaveBeenCalledWith({ queryKey: ["txns"] });
 });
 it("saves incomplete-section edits without approving and warns before losing edits", async () => {
  show();
  await screen.findByLabelText("Transaction name");
  fireEvent.change(screen.getByLabelText("Transaction name"), { target: { value: "New name" } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  expect(window.dispatchEvent(new Event("events:before-navigate", { cancelable: true }))).toBe(false);
  confirm.mockRestore();
  vi.mocked(saveSMSDraft).mockResolvedValue();
  vi.mocked(listSMSDrafts).mockResolvedValue({ drafts: [{ ...draft, revision: 2, category: "New name" }], next_offset: null });
  fireEvent.click(screen.getByRole("button", { name: "Save draft edits" }));
  expect(await screen.findByText("Draft edits saved. Nothing was added to your ledger.")).toBeInTheDocument();
  expect(saveSMSDraft).toHaveBeenCalledWith(draft, expect.objectContaining({ section: "", category: "New name" }));
  expect(approveSMSDraft).not.toHaveBeenCalled();
 });
 it("preserves unsaved edits and their original revision when another draft refreshes the list", async () => {
  const qc = show();
  await screen.findByLabelText("Transaction name");
  fireEvent.change(screen.getByLabelText("Transaction name"), { target: { value: "My unsaved edit" } });
  act(() => { qc.setQueryData(["sms-drafts"], { pages: [{ drafts: [{ ...draft, category: "Other session", revision: 2 }], next_offset: null }], pageParams: [0] }); });
  expect(await screen.findByRole("button", { name: "Load latest draft" })).toBeInTheDocument();
  expect(screen.getByLabelText("Transaction name")).toHaveValue("My unsaved edit");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Load latest draft" }));
  expect(screen.getByLabelText("Transaction name")).toHaveValue("My unsaved edit");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Load latest draft" }));
  expect(screen.getByLabelText("Transaction name")).toHaveValue("Other session");
  confirm.mockRestore();
 });
 it("requires ignore confirmation and creates no transaction", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Ignore" }));
  expect(ignoreSMSDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep draft" }));
  expect(screen.queryByRole("button", { name: "Confirm ignore" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
  vi.mocked(listSMSDrafts).mockResolvedValue({ drafts: [], next_offset: null });
  fireEvent.click(screen.getByRole("button", { name: "Confirm ignore" }));
  await waitFor(() => expect(ignoreSMSDraft).toHaveBeenCalledWith(draft));
  expect(approveSMSDraft).not.toHaveBeenCalled();
 });
 it("retains edits on failure and prevents a second in-flight approval", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(approveSMSDraft).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  show();
  const approve = await screen.findByRole("button", { name: "Approve and save Transaction" });
  fireEvent.change(screen.getByLabelText("Section"), { target: { value: "daily" } });
  fireEvent.click(approve); fireEvent.click(approve);
  await waitFor(() => expect(approveSMSDraft).toHaveBeenCalledTimes(1));
  expect(approve).toBeDisabled();
  reject(new AxiosError("offline"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are still here");
  expect(screen.getByLabelText("Section")).toHaveValue("daily");
 });
 it("loads further drafts and retries only failed jobs", async () => {
  vi.mocked(listSMSDrafts).mockResolvedValueOnce({ drafts: [draft], next_offset: 50 }).mockResolvedValue({ drafts: [{ ...draft, id: "draft-2", category: "SECOND" }], next_offset: null });
  vi.mocked(listFailedSMSJobs).mockResolvedValue([{ id: "job-1", status: "failed", failed_stage: "extraction", error_code: "provider_timeout", verification_attempts: 1, extraction_attempts: 3 }]);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Load more drafts" }));
  expect(await screen.findByRole("heading", { name: "SECOND" })).toBeInTheDocument();
  expect(listSMSDrafts).toHaveBeenCalledWith(50);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(retrySMSJob).toHaveBeenCalledWith("job-1"));
  expect(screen.getByText("Extraction failed")).toBeInTheDocument();
 });
 it("shows recoverable errors and empty state", async () => {
  vi.mocked(listSMSDrafts).mockRejectedValueOnce(new Error("offline"));
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load drafts");
  vi.mocked(listSMSDrafts).mockResolvedValue({ drafts: [], next_offset: null });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("heading", { name: "No drafts to review" })).toBeInTheDocument();
 });
});
