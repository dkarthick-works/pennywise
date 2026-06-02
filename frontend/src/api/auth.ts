import axios from "axios";
import { setToken, clearToken } from "./client";
import type { LoginRequest, SignupRequest, TokenResponse, Profile } from "../types";

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

export async function logout(): Promise<void> {
  clearToken();
  await axios.post("/api/auth/logout", {}, { withCredentials: true });
}

export async function fetchProfile(): Promise<Profile> {
  const { data } = await axios.get<Profile>("/api/me", {
    headers: { Authorization: `Bearer ${sessionStorage.getItem("pennywise_access_token")}` },
  });
  return data;
}
