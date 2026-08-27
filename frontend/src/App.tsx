import { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { AuthPage }      from "./pages/AuthPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CategoryGroupPage } from "./pages/CategoryGroupPage";
import { CategoryGroupComparisonPage } from "./pages/CategoryGroupComparisonPage";
import { CreditTransactionsPage } from "./pages/CreditTransactionsPage";
import { RecordPage }    from "./pages/RecordPage";
import { RecordEntryPage } from "./pages/RecordEntryPage";
import { SettingsPage }  from "./pages/SettingsPage";
import { ProfilePage }   from "./pages/ProfilePage";
import { InsightsPage }  from "./pages/InsightsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { LentsPage } from "./pages/LentsPage";
import { LentDetailPage } from "./pages/LentDetailPage";
import { ChitsPage } from "./pages/ChitsPage";
import { ChitCreatePage } from "./pages/ChitCreatePage";
import { ChitDetailPage } from "./pages/ChitDetailPage";
import { ChitEditPage } from "./pages/ChitEditPage";
import { ChitInstallmentCreatePage } from "./pages/ChitInstallmentCreatePage";
import { currentMonth }  from "./lib/dates";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, isLoading, hasRetryableError, retry } = useAuth();
  const location = useLocation();
  if (isLoading) return null; // hold until we know
  if (hasRetryableError) {
    return (
      <main className="min-h-screen grid place-items-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">Connection unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your session is preserved. Reconnect and try again.
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            onClick={() => void retry()}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  const [month, setMonth] = useState(currentMonth);

  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/" element={<Navigate to="/record" replace />} />

      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage month={month} setMonth={setMonth} />} />
                <Route path="/dashboard/groups/:groupId" element={<CategoryGroupPage month={month} />} />
                <Route path="/dashboard/groups/:groupId/compare" element={<CategoryGroupComparisonPage month={month} />} />
                <Route path="/dashboard/credits" element={<CreditTransactionsPage month={month} setMonth={setMonth} />} />
                <Route path="/record"    element={<RecordPage month={month} setMonth={setMonth} />} />
                <Route path="/record/entry" element={<RecordEntryPage month={month} setMonth={setMonth} />} />
                <Route path="/lents"     element={<LentsPage />} />
                <Route path="/lents/:id" element={<LentDetailPage />} />
                <Route path="/chits"     element={<ChitsPage />} />
                <Route path="/chits/new" element={<ChitCreatePage />} />
                <Route path="/chits/:id/edit" element={<ChitEditPage />} />
                <Route path="/chits/:id/installments/new" element={<ChitInstallmentCreatePage />} />
                <Route path="/chits/:id" element={<ChitDetailPage />} />
                <Route path="/insights"  element={<InsightsPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/export"    element={<ImportExportPage />} />
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
