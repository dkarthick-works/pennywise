// Thin axios wrapper that:
//  - Attaches the JWT access token from sessionStorage on every request.
//  - On 401, attempts one coordinated /api/auth/refresh then retries.
//  - Coordinates rotating refresh cookies across browser contexts.
//  - Distinguishes terminal refresh failures from retryable transport failures.

import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

const TOKEN_KEY = "pennywise_access_token";
const AUTH_CHANNEL = "pennywise_auth";
const REFRESH_LOCK = "pennywise_refresh";
const TERMINAL_REFRESH_STATUSES = new Set([400, 401, 403]);

type AuthMessage =
  | { type: "token"; token: string; generation: number; sentAt: number }
  | { type: "logout"; generation: number }
  | { type: "expired"; generation: number };

export class RetryableAuthError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Authentication refresh is temporarily unavailable");
    this.name = "RetryableAuthError";
    this.cause = cause;
  }
}

export class TerminalAuthError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("Authentication session has expired");
    this.name = "TerminalAuthError";
    this.cause = cause;
  }
}

let generation = 0;
let lastRemoteTokenAt = 0;
let channel: BroadcastChannel | null | undefined;

function authChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(AUTH_CHANNEL);
  if (channel) {
    channel.addEventListener("message", (event: MessageEvent<AuthMessage>) => {
      const message = event.data;
      if (!message || message.generation < generation) return;
      generation = message.generation;
      if (message.type === "token") {
        setToken(message.token);
        lastRemoteTokenAt = message.sentAt;
        window.dispatchEvent(new Event("auth:token"));
      } else {
        clearToken();
        window.dispatchEvent(new Event("auth:expired"));
      }
    });
  }
  return channel;
}

function publish(message: AuthMessage): void {
  authChannel()?.postMessage(message);
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string): void {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function invalidateSession(): void {
  generation += 1;
  clearToken();
  publish({ type: "logout", generation });
}

function expireSession(cause: unknown): never {
  generation += 1;
  clearToken();
  publish({ type: "expired", generation });
  window.dispatchEvent(new Event("auth:expired"));
  throw new TerminalAuthError(cause);
}

const client = axios.create({ baseURL: "/" });

// Attach Bearer token to every request.
client.interceptors.request.use((cfg: InternalAxiosRequestConfig) => {
  const tok = getToken();
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

let refreshing: Promise<string> | null = null;

async function requestRefresh(): Promise<string> {
  const requestGeneration = generation;
  try {
    const { data } = await axios.post<{ access_token: string }>(
      "/api/auth/refresh",
      {},
      { withCredentials: true },
    );
    if (requestGeneration !== generation) {
      throw new TerminalAuthError(new Error("Refresh superseded by logout"));
    }
    setToken(data.access_token);
    publish({
      type: "token",
      token: data.access_token,
      generation,
      sentAt: Date.now(),
    });
    return data.access_token;
  } catch (error) {
    if (error instanceof TerminalAuthError) throw error;
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status !== undefined && TERMINAL_REFRESH_STATUSES.has(status)) {
      return expireSession(error);
    }
    throw new RetryableAuthError(error);
  }
}

async function coordinatedRefresh(): Promise<string> {
  authChannel();
  const startedAt = Date.now();
  const locks = navigator.locks;
  if (!locks?.request) return requestRefresh();

  return locks.request(REFRESH_LOCK, async () => {
    // A lock holder in another context broadcasts its token before releasing.
    // Yield once so the BroadcastChannel task can update this context.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const remoteToken = getToken();
    if (remoteToken && lastRemoteTokenAt >= startedAt) return remoteToken;
    return requestRefresh();
  });
}

export function refreshSession(): Promise<string> {
  if (!refreshing) {
    refreshing = coordinatedRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

client.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err);
    }
    original._retry = true;

    const tok = await refreshSession();
    original.headers.Authorization = `Bearer ${tok}`;
    return client(original);
  },
);

export default client;
