import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { updateProfile } from "../api/ledger";
import { initials } from "../lib/txns";
import { IconCheck, IconLock, IconLogout } from "../components/ui/Icons";

export function ProfilePage() {
  const { profile, logout, setProfile } = useAuth();
  const qc = useQueryClient();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [email, setEmail]             = useState(profile?.email ?? "");
  const [saved, setSaved]             = useState(false);

  const saveMut = useMutation({
    mutationFn: () => updateProfile({ display_name: displayName, email }),
    onSuccess: (p) => {
      setProfile(p);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  const userInitials = initials(displayName || email.split("@")[0] || "?");

  return (
    <div className="content fade-in" style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-sub">Your account details.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <div className="avatar" style={{ width: 60, height: 60, fontSize: 22 }}>{userInitials}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{displayName || email.split("@")[0]}</div>
            <div className="muted" style={{ fontSize: 13.5 }}>{email}</div>
          </div>
        </div>

        <div className="field">
          <label>Display name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button
            className="btn btn-primary"
            style={{ width: "auto" }}
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? "Saving…" : "Save changes"}
          </button>
          {saved && (
            <span style={{ color: "var(--pos)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
              <IconCheck size={15} /> Saved
            </span>
          )}
        </div>
      </div>

      {/* Change password is handled by Goauth (forgot-password flow). */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <h3 className="card-h" style={{ marginBottom: 4 }}>
          <IconLock size={15} /> Change password
        </h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          Use the "Forgot password" flow from the login screen to set a new password.
          Password management is handled by the authentication service.
        </p>
      </div>

      <button
        className="btn btn-soft"
        onClick={logout}
        style={{ color: "var(--neg)", borderColor: "var(--border)" }}
      >
        <IconLogout size={16} /> Sign out
      </button>
    </div>
  );
}
