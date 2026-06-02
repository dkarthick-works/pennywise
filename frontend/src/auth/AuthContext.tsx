import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { login as apiLogin, logout as apiLogout } from "../api/auth";
import { getToken, clearToken } from "../api/client";
import type { LoginRequest, Profile } from "../types";
import client from "../api/client";

interface AuthState {
  token: string | null;
  profile: Profile | null;
  isLoading: boolean;
}

interface AuthCtx extends AuthState {
  login: (body: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  setProfile: (p: Profile) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<AuthState>({
    token: getToken(),
    profile: null,
    isLoading: true,
  });

  // On mount, if we have a token already, fetch /api/me to rehydrate profile.
  useEffect(() => {
    if (!getToken()) {
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }
    client
      .get<Profile>("/api/me")
      .then(({ data }) =>
        setState({ token: getToken(), profile: data, isLoading: false })
      )
      .catch(() => {
        clearToken();
        setState({ token: null, profile: null, isLoading: false });
      });
  }, []);

  // Listen for token-expired events fired by the axios interceptor.
  useEffect(() => {
    const handler = () => {
      setState({ token: null, profile: null, isLoading: false });
      qc.clear();
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [qc]);

  const login = useCallback(async (body: LoginRequest) => {
    await apiLogin(body);
    const { data } = await client.get<Profile>("/api/me");
    setState({ token: getToken(), profile: data, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setState({ token: null, profile: null, isLoading: false });
    qc.clear();
  }, [qc]);

  const setProfile = useCallback(
    (p: Profile) => setState((s) => ({ ...s, profile: p })),
    []
  );

  return (
    <Ctx.Provider value={{ ...state, login, logout, setProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
