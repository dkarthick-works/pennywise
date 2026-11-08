import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SMSDevicesCard } from "./SMSDevicesCard";
import { createSMSDevice, listSMSDevices, revokeSMSDevice } from "../api/sms";

vi.mock("../api/sms", () => ({ createSMSDevice: vi.fn(), listSMSDevices: vi.fn(), revokeSMSDevice: vi.fn() }));
const device = { id: "phone-id", label: "My phone", enabled: false, revoked_at: null, last_upload_at: null, last_scan_end: null };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SMSDevicesCard /></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listSMSDevices).mockResolvedValue([]);
});
describe("SMS device settings", () => {
  it("creates a named token, shows it once, and can dismiss it", async () => {
    vi.mocked(createSMSDevice).mockResolvedValue({ device, token: "sms_private" });
    show();
    expect(await screen.findByText("No SMS devices connected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create device token" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "  My phone  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create device token" }));
    expect(await screen.findByLabelText("New device token")).toHaveValue("sms_private");
    expect(createSMSDevice).toHaveBeenCalledWith("My phone");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss token" }));
    expect(screen.queryByLabelText("New device token")).not.toBeInTheDocument();
  });
  it("revokes only after confirmation", async () => {
    vi.mocked(listSMSDevices).mockResolvedValue([device]);
    vi.mocked(revokeSMSDevice).mockResolvedValue();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    const revoke = await screen.findByRole("button", { name: "Revoke token" });
    fireEvent.click(revoke);
    expect(revokeSMSDevice).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(revoke);
    await waitFor(() => expect(revokeSMSDevice).toHaveBeenCalledWith("phone-id", expect.anything()));
    confirm.mockRestore();
  });
  it("shows recoverable load and creation failures", async () => {
    vi.mocked(listSMSDevices).mockRejectedValue(new Error("offline"));
    vi.mocked(createSMSDevice).mockRejectedValue(new Error("offline"));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load devices");
    fireEvent.change(screen.getByLabelText("Device name"), { target: { value: "Phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Create device token" }));
    expect(await screen.findByText(/Could not create a device token/)).toBeInTheDocument();
  });
});
