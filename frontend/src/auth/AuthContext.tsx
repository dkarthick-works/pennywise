import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { login as apiLogin, logout as apiLogout } from "../api/auth";
import {
  getToken,
  refreshSession,
  RetryableAuthError,
  TerminalAuthError,
} from "../api/client";
import type { LoginRequest, Profile } from "../types";
import client from "../api/client";

interface AuthState {
  token: string | null;
  profile: Profile | null;
  isLoading: boolean;
  hasRetryableError: boolean;
}

interface AuthCtx extends AuthState {
  login: (body: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  setProfile: (p: Profile) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>({
    token: getToken(),
    profile: null,
    isLoading: true,
    hasRetryableError: false,
  });

  const hydrate = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, hasRetryableError: false }));
    try {
      if (!getToken()) await refreshSession();
      const { data } = await client.get<Profile>("/api/me");
      setState({
        token: getToken(),
        profile: data,
        isLoading: false,
        hasRetryableError: false,
      });
    } catch (error) {
      if (error instanceof TerminalAuthError) {
        setState({
          token: null,
          profile: null,
          isLoading: false,
          hasRetryableError: false,
        });
        return;
      }
      // Network failures, 5xx responses, and explicitly retryable refresh
      // failures preserve the token and cached user data.
      const status = typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
      const retryable = error instanceof RetryableAuthError
        || status === undefined
        || status >= 500;
      setState((s) => ({
        ...s,
        token: getToken(),
        isLoading: false,
        hasRetryableError: retryable,
      }));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(hydrate);
  }, [hydrate]);

  // Listen for token-expired events fired by the axios interceptor.
  useEffect(() => {
    const handler = () => {
      setState({
        token: null,
        profile: null,
        isLoading: false,
        hasRetryableError: false,
      });
      qc.clear();
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [qc]);

  useEffect(() => {
    const onToken = () => {
      const token = getToken();
      if (!token) return;
      // Another tab rotated the access token, not the profile. Rehydrating a
      // healthy session would set isLoading and unmount the user's active form.
      if (state.profile && !state.hasRetryableError) {
        setState((s) => ({ ...s, token }));
      } else if (!state.isLoading) {
        // Bootstrap already in flight will read the latest token on completion.
        void hydrate();
      }
    };
    window.addEventListener("auth:token", onToken);
    return () => window.removeEventListener("auth:token", onToken);
  }, [hydrate, state.profile, state.hasRetryableError, state.isLoading]);

  // Tab visibility alone is not a reason to rotate a healthy session or reload
  // /api/me. Bootstrap restores missing sessions; the API client's 401 handler
  // refreshes expired tokens and retries the actual request when necessary.

  const login = useCallback(async (body: LoginRequest) => {
    await apiLogin(body);
    const { data } = await client.get<Profile>("/api/me");
    setState({
      token: getToken(),
      profile: data,
      isLoading: false,
      hasRetryableError: false,
    });
  }, []);

  const logout = useCallback(async () => {
    const request = apiLogout();
    setState({
      token: null,
      profile: null,
      isLoading: false,
      hasRetryableError: false,
    });
    qc.clear();
    await request;
  }, [qc]);

  const setProfile = useCallback(
    (p: Profile) => setState((s) => ({ ...s, profile: p })),
    []
  );

  return (
    <Ctx.Provider value={{ ...state, login, logout, retry: hydrate, setProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
