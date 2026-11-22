import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

// UX guard only. The API enforces admin access on every request.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, isLoading } = useAuth();
  if (isLoading) return null;
  if (!profile?.is_admin) return <Navigate to="/record" replace />;
  return <>{children}</>;
}
