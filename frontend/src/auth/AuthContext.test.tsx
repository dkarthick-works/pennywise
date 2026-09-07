import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  refreshSession: vi.fn(),
  getToken: vi.fn(),
  apiLogin: vi.fn(),
  apiLogout: vi.fn(),
  RetryableAuthError: class RetryableAuthError extends Error {},
  TerminalAuthError: class TerminalAuthError extends Error {},
}));

const {
  get, refreshSession, getToken, apiLogin, apiLogout,
  RetryableAuthError,
} = mocks;

vi.mock("../api/client", () => ({
  default: { get: mocks.get },
  getToken: mocks.getToken,
  refreshSession: mocks.refreshSession,
  RetryableAuthError: mocks.RetryableAuthError,
  TerminalAuthError: mocks.TerminalAuthError,
}));

vi.mock("../api/auth", () => ({
  login: mocks.apiLogin,
  logout: mocks.apiLogout,
}));

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="state">
        {auth.isLoading ? "loading" : auth.hasRetryableError ? "retry" : auth.token ?? "anonymous"}
      </span>
      <button type="button" onClick={() => void auth.retry()}>retry</button>
      <button type="button" onClick={() => void auth.logout()}>logout</button>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthProvider session bootstrap", () => {
  beforeEach(() => {
    get.mockReset();
    refreshSession.mockReset();
    getToken.mockReset();
    apiLogin.mockReset();
    apiLogout.mockReset();
  });

  it("restores a session from the refresh cookie when sessionStorage is empty", async () => {
    let token: string | null = null;
    getToken.mockImplementation(() => token);
    refreshSession.mockImplementation(async () => {
      token = "fresh";
      return token;
    });
    get.mockResolvedValue({
      data: { user_id: "u1", email: "user@example.com", display_name: "User" },
    });

    renderProvider();

    expect(await screen.findByTestId("state")).toHaveTextContent("fresh");
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("/api/me");
  });

  it("preserves the session and exposes retry after offline bootstrap", async () => {
    let token: string | null = null;
    getToken.mockImplementation(() => token);
    refreshSession
      .mockRejectedValueOnce(new RetryableAuthError("offline"))
      .mockImplementationOnce(async () => {
        token = "fresh";
        return token;
      });
    get.mockResolvedValue({
      data: { user_id: "u1", email: "user@example.com", display_name: "User" },
    });

    renderProvider();
    expect(await screen.findByTestId("state")).toHaveTextContent("retry");

    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("fresh"));
  });

  it("does not refresh or reload the profile on repeated tab switches", async () => {
    getToken.mockReturnValue("stored");
    refreshSession.mockResolvedValue("fresh");
    get.mockResolvedValue({
      data: { user_id: "u1", email: "user@example.com", display_name: "User" },
    });
    renderProvider();
    await screen.findByText("stored");

    for (let i = 0; i < 3; i++) {
      for (const visibilityState of ["hidden", "visible"]) {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: visibilityState });
        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      }
    }
    expect(refreshSession).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledOnce();
    expect(screen.getByTestId("state")).toHaveTextContent("stored");
  });

  it("adopts a cross-tab token without rehydrating an already loaded profile", async () => {
    let token = "stored";
    getToken.mockImplementation(() => token);
    get.mockResolvedValue({ data: { user_id: "u1", email: "user@example.com", display_name: "User" } });
    renderProvider();
    await screen.findByText("stored");

    token = "rotated-in-another-tab";
    await act(async () => { window.dispatchEvent(new Event("auth:token")); });
    expect(screen.getByTestId("state")).toHaveTextContent(token);
    expect(get).toHaveBeenCalledOnce();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("does not start a second hydration when a token arrives during bootstrap", async () => {
    getToken.mockReturnValue("stored");
    let finish!: (response: { data: { user_id: string; email: string; display_name: string } }) => void;
    get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderProvider();
    await waitFor(() => expect(get).toHaveBeenCalledOnce());
    await act(async () => { window.dispatchEvent(new Event("auth:token")); });
    expect(get).toHaveBeenCalledOnce();
    await act(async () => { finish({ data: { user_id: "u1", email: "user@example.com", display_name: "User" } }); });
    expect(screen.getByTestId("state")).toHaveTextContent("stored");
  });

  it("completes local logout before the server request settles", async () => {
    getToken.mockReturnValue("stored");
    get.mockResolvedValue({
      data: { user_id: "u1", email: "user@example.com", display_name: "User" },
    });
    apiLogout.mockReturnValue(new Promise(() => {}));
    renderProvider();
    await screen.findByText("stored");

    fireEvent.click(screen.getByRole("button", { name: "logout" }));

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
  });
});
