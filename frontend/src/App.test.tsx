import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import App from "./App";

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App — public password-reset routes", () => {
  it("renders ForgotPasswordPage at /forgot-password without authentication", async () => {
    renderApp("/forgot-password");
    expect(await screen.findByPlaceholderText("you@email.com")).toBeInTheDocument();
  });
});
