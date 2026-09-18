import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ profile: { email: "test@example.com", display_name: "Test" } }) }));
function Location() { const { pathname } = useLocation(); return <p data-testid="location">{pathname}</p>; }

describe("Reserves navigation", () => {
  it("is primary navigation with an active state", () => {
    render(<MemoryRouter initialEntries={["/reserves"]}><AppShell><Location /></AppShell></MemoryRouter>);
    const button = screen.getByRole("button", { name: "Reserves" });
    expect(button).toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard");
    fireEvent.click(button);
    expect(screen.getByTestId("location")).toHaveTextContent("/reserves");
  });
});
