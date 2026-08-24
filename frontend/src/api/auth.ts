import axios from "axios";
import { setToken, invalidateSession } from "./client";
import type {
  LoginRequest,
  SignupRequest,
  TokenResponse,
  Profile,
  ForgotPasswordRequest,
} from "../types";

// Auth calls go through the same proxy origin.
// Login/signup use a separate axios instance (no auth header needed / wanted).

export async function login(body: LoginRequest): Promise<void> {
  const { data } = await axios.post<TokenResponse>("/api/auth/login", body, {
    withCredentials: true,
  });
  setToken(data.access_token);
}

export async function signup(body: SignupRequest): Promise<void> {
  await axios.post("/api/auth/signup", body);
}

// Always resolves on any 2xx — Goauth returns 200 unconditionally to avoid
// leaking whether an email is registered. Rejects on network errors / 5xx so
// the caller can distinguish "request sent" from "request failed".
export async function forgotPassword(body: ForgotPasswordRequest): Promise<void> {
  await axios.post("/api/auth/forgot-password", body);
}

export async function logout(): Promise<void> {
  invalidateSession();
  try {
    await axios.post("/api/auth/logout", {}, { withCredentials: true });
  } catch {
    // Local logout is authoritative. A failed server request must not restore
    // authentication; the refresh cookie can be cleared on a later attempt.
  }
}

export async function fetchProfile(): Promise<Profile> {
  const { data } = await axios.get<Profile>("/api/me", {
    headers: { Authorization: `Bearer ${sessionStorage.getItem("pennywise_access_token")}` },
  });
  return data;
}
