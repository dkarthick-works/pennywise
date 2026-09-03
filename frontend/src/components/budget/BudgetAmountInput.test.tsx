import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BudgetAmountInput } from "./BudgetAmountInput";

function typeInto(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("BudgetAmountInput", () => {
  it("hydrates comma-formatted integers and two-decimal values", () => {
    const { rerender } = render(<BudgetAmountInput value={15000} onCommit={() => {}} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    expect(input.value).toBe("15,000");

    rerender(<BudgetAmountInput value={10000.25} onCommit={() => {}} aria-label="Budget" />);
    expect(input.value).toBe("10,000.25");
  });

  it("commits a two-decimal value on blur", () => {
    const onCommit = vi.fn();
    render(<BudgetAmountInput value={0} onCommit={onCommit} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    typeInto(input, "10000.25");
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(10000.25);
  });

  it("commits on Enter and ignores the following blur", () => {
    const onCommit = vi.fn();
    render(<BudgetAmountInput value={0} onCommit={onCommit} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    typeInto(input, "15000");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(15000);
  });

  it("does not save an unchanged value", () => {
    const onCommit = vi.fn();
    render(<BudgetAmountInput value={15000} onCommit={onCommit} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows a validation message for excess precision and does not save", () => {
    const onCommit = vi.fn();
    render(<BudgetAmountInput value={0} onCommit={onCommit} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.001" } });
    expect(input.value).toBe("1.00");
    fireEvent.change(input, { target: { value: "9999999999999.99" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/exceeds the maximum/i)).toBeInTheDocument();
  });

  it("restores the last confirmed value on Escape", () => {
    const onCommit = vi.fn();
    render(<BudgetAmountInput value={15000} onCommit={onCommit} aria-label="Budget" />);
    const input = screen.getByLabelText("Budget") as HTMLInputElement;
    typeInto(input, "9");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("15,000");
    expect(onCommit).not.toHaveBeenCalled();
  });
});
