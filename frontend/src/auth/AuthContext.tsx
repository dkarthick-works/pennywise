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
    const onToken = () => void hydrate();
    const onVisible = () => {
      if (document.visibilityState === "visible" && getToken()) {
        void refreshSession().then(() => hydrate()).catch((error) => {
          if (error instanceof RetryableAuthError) {
            setState((s) => ({ ...s, hasRetryableError: true }));
          }
        });
      }
    };
    window.addEventListener("auth:token", onToken);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("auth:token", onToken);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrate]);

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
