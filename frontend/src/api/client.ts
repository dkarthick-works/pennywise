// Thin axios wrapper that:
//  - Attaches the JWT access token from sessionStorage on every request.
//  - On 401, attempts one silent /api/auth/refresh then retries.
//  - On refresh failure clears the token and fires a custom "auth:expired" event
//    so the auth context can redirect to login.

import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

const TOKEN_KEY = "pennywise_access_token";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

const client = axios.create({ baseURL: "/" });

// Attach Bearer token to every request.
client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const tok = getToken();
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

// One-shot refresh on 401 then retry the original request.
let refreshing: Promise<string> | null = null;

client.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err);
    }
    original._retry = true;

    if (!refreshing) {
      refreshing = axios
        .post<{ access_token: string }>("/api/auth/refresh", {}, { withCredentials: true })
        .then((r) => {
          const tok = r.data.access_token;
          setToken(tok);
          refreshing = null;
          return tok;
        })
        .catch((e) => {
          clearToken();
          refreshing = null;
          window.dispatchEvent(new Event("auth:expired"));
          return Promise.reject(e);
        });
    }

    const tok = await refreshing;
    original.headers.Authorization = `Bearer ${tok}`;
    return client(original);
  },
);

export default client;
