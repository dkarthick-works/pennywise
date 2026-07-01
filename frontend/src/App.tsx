import { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { AuthPage }      from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CategoryGroupPage } from "./pages/CategoryGroupPage";
import { RecordPage }    from "./pages/RecordPage";
import { SettingsPage }  from "./pages/SettingsPage";
import { ProfilePage }   from "./pages/ProfilePage";
import { InsightsPage }  from "./pages/InsightsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { ExportPage } from "./pages/ExportPage";
import { currentMonth }  from "./lib/dates";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return null; // hold until we know
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  const [month, setMonth] = useState(currentMonth);

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/" element={<Navigate to="/record" replace />} />

      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage month={month} setMonth={setMonth} />} />
                <Route path="/dashboard/groups/:groupId" element={<CategoryGroupPage month={month} />} />
                <Route path="/record"    element={<RecordPage month={month} setMonth={setMonth} />} />
                <Route path="/insights"  element={<InsightsPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/export"    element={<ExportPage />} />
                <Route path="/settings"  element={<SettingsPage />} />
                <Route path="/profile"   element={<ProfilePage />} />
                <Route path="*"          element={<Navigate to="/record" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
