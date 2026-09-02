import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({
    token: "test-token",
    isLoading: false,
    hasRetryableError: false,
    retry: vi.fn(),
    profile: { email: "test@example.com", display_name: "Test User" },
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("App — cash-flow route", () => {
  it("renders the cash-flow transaction page", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard/cash-flow?month=2026-08"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Cash Flow Transactions" })).toBeInTheDocument();
  });
});
