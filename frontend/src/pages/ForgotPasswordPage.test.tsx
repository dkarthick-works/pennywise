import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

const mocks = { forgotPassword: vi.fn() };

vi.mock("../api/auth", () => ({
  forgotPassword: (body: unknown) => mocks.forgotPassword(body),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.forgotPassword.mockReset();
});

describe("ForgotPasswordPage", () => {
  it("rejects an invalid email before calling the API", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/i }));
    expect(screen.getByText(/Enter a valid email/i)).toBeInTheDocument();
    expect(mocks.forgotPassword).not.toHaveBeenCalled();
  });

  it("sends the trimmed email and shows the anti-enumeration success hint only after a confirmed response", async () => {
    mocks.forgotPassword.mockResolvedValue(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "  user@example.com  " } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/i }));

    await waitFor(() => expect(mocks.forgotPassword).toHaveBeenCalledWith({ email: "user@example.com" }));
    expect(await screen.findByText(/we've sent a link to reset your password/i)).toBeInTheDocument();
  });

  it("shows a distinct failure message on a network/5xx error, never the success copy", async () => {
    mocks.forgotPassword.mockRejectedValue(new Error("network down"));
    renderPage();
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "user@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send reset link/i }));

    expect(await screen.findByText(/Something went wrong — please try again/i)).toBeInTheDocument();
    expect(screen.queryByText(/we've sent a link/i)).not.toBeInTheDocument();
  });

  it("Back to sign in navigates to /login", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Back to sign in/i }));
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });
});
