import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import { AuthPage } from "./AuthPage";

function renderAuthPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/login"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route path="/forgot-password" element={<div>Forgot page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
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
