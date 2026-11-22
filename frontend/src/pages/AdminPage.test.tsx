import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { AdminPage } from "./AdminPage";
import { RequireAdmin } from "../auth/RequireAdmin";
import { AppShell } from "../components/layout/AppShell";
import { listAdminUsers } from "../api/admin";
import type { AdminUsersResponse, Profile } from "../types";

const auth = vi.hoisted(() => ({
  profile: null as Profile | null,
  isLoading: false,
  setProfile: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../api/admin", () => ({ ADMIN_PAGE_SIZE: 50, listAdminUsers: vi.fn() }));

const admin: Profile = { user_id: "admin", email: "admin@example.com", display_name: "Admin", is_admin: true };
const response: AdminUsersResponse = {
  users: [
    { user_id: "u1", email: "one@example.com", display_name: "One", joined_at: "2026-01-02T00:00:00Z", transaction_count: 12 },
    { user_id: "u2", email: "", display_name: "", joined_at: "2026-01-03T00:00:00Z", transaction_count: 0 },
  ],
  total_users: 120,
  total_transactions: 345,
  limit: 50,
  offset: 0,
};

function httpError(status: number) {
  return new AxiosError("failed", undefined, undefined, undefined, {
    status, statusText: "", data: {}, headers: {}, config: { headers: new AxiosHeaders() },
  });
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
          <Route path="/record" element={<p>Record page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.profile = admin;
  auth.isLoading = false;
  vi.mocked(listAdminUsers).mockResolvedValue(response);
});

describe("AdminPage", () => {
  it("shows users, totals, and a user ID when name and email are blank", async () => {
    show();
    expect(await screen.findByText("One")).toBeInTheDocument();
    expect(screen.getByText("one@example.com")).toBeInTheDocument();
    expect(screen.getByText("u2")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("345")).toBeInTheDocument();
  });

  it("requests the next page", async () => {
    show();
    await screen.findByText("One");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listAdminUsers).toHaveBeenCalledWith(50));
  });

  it("shows a retry on load failure", async () => {
    vi.mocked(listAdminUsers).mockRejectedValueOnce(httpError(500));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("One")).toBeInTheDocument();
  });

  it("explains when the server disables admin access", async () => {
    vi.mocked(listAdminUsers).mockRejectedValue(httpError(503));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("real JWT secret");
  });

  it("drops admin state when the API reports access was revoked", async () => {
    vi.mocked(listAdminUsers).mockRejectedValue(httpError(403));
    show();
    await waitFor(() => expect(auth.setProfile).toHaveBeenCalledWith({ ...admin, is_admin: false }));
  });
});

describe("admin access UI", () => {
  it("redirects non-admins without loading user data", async () => {
    auth.profile = { ...admin, is_admin: false };
    show();
    expect(await screen.findByText("Record page")).toBeInTheDocument();
    expect(listAdminUsers).not.toHaveBeenCalled();
  });

  it("waits for auth loading before redirecting", () => {
    auth.profile = null;
    auth.isLoading = true;
    show();
    expect(screen.queryByText("Record page")).not.toBeInTheDocument();
  });

  it("shows the Admin nav item only to admins", () => {
    const { unmount } = render(<MemoryRouter><AppShell><p>x</p></AppShell></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Admin" })).toBeInTheDocument();
    unmount();
    auth.profile = { ...admin, is_admin: false };
    render(<MemoryRouter><AppShell><p>x</p></AppShell></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Admin" })).not.toBeInTheDocument();
  });
});
