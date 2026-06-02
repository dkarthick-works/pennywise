import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { initials } from "../../lib/txns";
import {
  IconDashboard, IconRecord, IconSettings, IconProfile, IconMenu,
} from "../ui/Icons";

const NAV = [
  { path: "/dashboard", label: "Dashboard",        Icon: IconDashboard },
  { path: "/record",    label: "Record & Expense",  Icon: IconRecord },
  { path: "/settings",  label: "Settings",          Icon: IconSettings },
  { path: "/profile",   label: "Profile",           Icon: IconProfile },
];

interface Props {
  children: React.ReactNode;
}

export function AppShell({ children }: Props) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  const userInitials = profile
    ? initials(profile.display_name || profile.email.split("@")[0])
    : "?";

  function go(path: string) {
    navigate(path);
    setNavOpen(false);
  }

  return (
    <div className="shell">
      {/* mobile scrim */}
      <div
        className={"scrim" + (navOpen ? " show" : "")}
        onClick={() => setNavOpen(false)}
      />

      {/* sidebar */}
      <aside className={"sidebar" + (navOpen ? " open" : "")}>
        <div className="side-brand">
          <div className="logo-mark"><span>P</span></div>
          <div className="logo-word">Pennywise</div>
        </div>

        <nav className="nav">
          <div className="nav-label">Menu</div>
          {NAV.map(({ path, label, Icon }) => (
            <button
              key={path}
              className={"nav-item" + (pathname.startsWith(path) ? " active" : "")}
              onClick={() => go(path)}
            >
              <Icon /> {label}
            </button>
          ))}
        </nav>

        <div className="side-user" onClick={() => go("/profile")}>
          <div className="avatar">{userInitials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="nm"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {profile?.display_name || profile?.email.split("@")[0] || "—"}
            </div>
            <div
              className="em"
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {profile?.email || ""}
            </div>
          </div>
        </div>
      </aside>

      {/* main */}
      <main className="main">
        <div className="topbar">
          <button
            className="hamburger"
            onClick={() => setNavOpen(true)}
            aria-label="Menu"
          >
            <IconMenu size={20} />
          </button>
          <div className="logo-mark" style={{ width: 26, height: 26 }}>
            <span style={{ fontSize: 14 }}>P</span>
          </div>
          <div className="logo-word" style={{ fontSize: 17 }}>Pennywise</div>
        </div>

        {children}
      </main>
    </div>
  );
}
