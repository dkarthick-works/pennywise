import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

const auth = vi.hoisted((): { token: string | null } => ({ token: "test-token" }));
vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({
    token: auth.token, isLoading: false, hasRetryableError: false, retry: vi.fn(),
    profile: { email: "test@example.com", display_name: "Test User" },
  }),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/transactions/search"]}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { auth.token = "test-token"; });

describe("transaction search page", () => {
  it("opens directly and places its active sidebar item immediately below Dashboard", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toBeInTheDocument();
    const search = screen.getByRole("button", { name: "Search" });
    const dashboard = screen.getByRole("button", { name: "Dashboard" });
    expect(dashboard.nextElementSibling).toBe(search);
    expect(search).toHaveClass("active");
    expect(search.querySelector("svg")).toBeInTheDocument();
    expect(dashboard).not.toHaveClass("active");
  });

  it("closes the mobile navigation drawer after selecting search", () => {
    mount();
    const search = screen.getByRole("button", { name: "Search" });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(search.closest("aside")).toHaveClass("open");
    fireEvent.click(search);
    expect(search.closest("aside")).not.toHaveClass("open");
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
  });

  it("requires authentication when opened directly", () => {
    auth.token = null;
    mount();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});
