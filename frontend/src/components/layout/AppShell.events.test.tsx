import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ profile: { email: "test@example.com", display_name: "Test" } }) }));
function Location() { const { pathname } = useLocation(); return <p data-testid="location">{pathname}</p>; }
describe("Events navigation", () => {
  it("highlights Events for nested routes and closes the mobile drawer", () => {
    render(<MemoryRouter initialEntries={["/events/event-1/edit"]}><AppShell><Location /></AppShell></MemoryRouter>);
    const button = screen.getByRole("button", { name: "Events" }); expect(button).toHaveClass("active");
    fireEvent.click(screen.getByRole("button", { name: "Menu" })); expect(button.closest("aside")).toHaveClass("open");
    fireEvent.click(button); expect(screen.getByTestId("location")).toHaveTextContent("/events"); expect(button.closest("aside")).not.toHaveClass("open");
  });
});
