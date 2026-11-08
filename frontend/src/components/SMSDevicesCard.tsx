import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSMSDevice, listSMSDevices, revokeSMSDevice } from "../api/sms";

export function SMSDevicesCard() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["sms-devices"], queryFn: listSMSDevices });
  const [label, setLabel] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const create = useMutation({
    mutationFn: () => createSMSDevice(label.trim()),
    onSuccess: (result) => {
      setToken(result.token);
      setCopied(false);
      setCopyFailed(false);
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["sms-devices"] });
    },
  });
  const revoke = useMutation({
    mutationFn: revokeSMSDevice,
    onSuccess: () => {
      setToken(null);
      void qc.invalidateQueries({ queryKey: ["sms-devices"] });
    },
  });
  return (
    <section className="card card-pad" style={{ marginBottom: 18 }} aria-labelledby="sms-devices-heading">
      <h3 id="sms-devices-heading" className="card-h">Android SMS import</h3>
      <p style={{ fontSize: 13, color: "var(--ink-2)" }}>
        Connect the personal Android app with a device token, then enable SMS import in its native settings.
        Only messages from the global sender list are uploaded. They may include OTPs or promotions.
        AI processing follows the backend configuration. Review and edit results on the{" "}
        <a href="/sms-drafts">SMS Drafts page</a>. Only your approval saves a Transaction to the ledger.
      </p>
      <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <label htmlFor="sms-device-label">Device name</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input id="sms-device-label" className="input" value={label} maxLength={80}
            placeholder="My Android phone" style={{ flex: "1 1 180px", minWidth: 0 }}
            onChange={(event) => setLabel(event.target.value)} disabled={create.isPending} />
          <button className="btn btn-soft" disabled={!label.trim() || create.isPending || token !== null}>
            {create.isPending ? "Creating…" : "Create device token"}
          </button>
        </div>
      </form>
      {create.isError && <p role="alert">Could not create a device token. Try again or revoke an unused device.</p>}
      {token && <div style={{ marginTop: 16 }}>
        <p>Shown once. Paste this token into Android SMS settings. Keep it private.</p>
        <label htmlFor="sms-device-token">New device token</label>
        <input id="sms-device-token" className="input" value={token} readOnly autoComplete="off"
          data-clarity-mask="true" data-private="true" spellCheck={false} style={{ width: "100%", boxSizing: "border-box", margin: "8px 0" }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-soft" onClick={async () => {
            try { await navigator.clipboard.writeText(token); setCopied(true); setCopyFailed(false); }
            catch { setCopyFailed(true); }
          }}>{copied ? "Copied" : "Copy token"}</button>
          <button type="button" className="btn btn-soft" onClick={() => setToken(null)}>Dismiss token</button>
        </div>
        {copyFailed && <p role="status">Select the token field and copy it manually.</p>}
      </div>}
      {devices.isPending && <p role="status">Loading SMS devices…</p>}
      {devices.isError && <p role="alert">Could not load devices. <button className="btn btn-soft" onClick={() => void devices.refetch()}>Retry</button></p>}
      {devices.data?.length === 0 && <p style={{ color: "var(--ink-2)" }}>No SMS devices connected.</p>}
      {devices.data?.map((device) => <div key={device.id} style={{ borderTop: "1px solid var(--border-2)", marginTop: 16, paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <strong style={{ overflowWrap: "anywhere" }}>{device.label}</strong>
          <span>{device.revoked_at ? "Revoked" : device.enabled ? "Enabled" : "Disabled"}</span>
          {!device.revoked_at && <button type="button" className="btn btn-soft" disabled={revoke.isPending}
            onClick={() => { if (window.confirm(`Revoke ${device.label}? This stops uploads and cancels its unprocessed messages.`)) revoke.mutate(device.id); }}>
            Revoke token
          </button>}
        </div>
        <p style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
          Last contact: {device.last_upload_at ? new Date(device.last_upload_at).toLocaleString() : "Never"}
          {device.last_scan_end != null && <> · Synced through {new Date(device.last_scan_end).toLocaleString()}</>}
        </p>
      </div>)}
      {revoke.isError && <p role="alert">Could not revoke the token. Try again.</p>}
    </section>
  );
}
