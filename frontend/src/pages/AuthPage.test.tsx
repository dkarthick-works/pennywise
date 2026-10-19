import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { AuthPage } from "./AuthPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ login: vi.fn().mockResolvedValue(undefined) }),
}));

function GoBack() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}

function renderAuthPage(initialEntries = ["/login"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <Routes>
        <Route path="/start" element={<div>Start page</div>} />
        <Route path="/login" element={<AuthPage />} />
        <Route path="/record" element={<GoBack />} />
        <Route path="/forgot-password" element={<div>Forgot page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthPage — forgot password entry point", () => {
  it("shows 'Forgot password?' in sign-in mode and navigates to /forgot-password", () => {
    renderAuthPage();
    const link = screen.getByRole("button", { name: /Forgot password\?/i });
    expect(link).toBeInTheDocument();

    fireEvent.click(link);
    expect(screen.getByText("Forgot page")).toBeInTheDocument();
  });

  it("hides 'Forgot password?' in register mode", () => {
    renderAuthPage();
    fireEvent.click(screen.getByRole("button", { name: /Create one/i }));
    expect(screen.queryByRole("button", { name: /Forgot password\?/i })).not.toBeInTheDocument();
  });
});

describe("AuthPage — sign in", () => {
  it("replaces /login in history so Back skips the login form", async () => {
    renderAuthPage(["/start", "/login"]);
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret1" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    expect(screen.getByText("Start page")).toBeInTheDocument();
  });
});
