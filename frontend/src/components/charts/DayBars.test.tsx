import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DayBars } from "./Charts";
import type { DailySpendDay } from "../../lib/txns";

function seriesForMonth(days: number, values: Record<number, number> = {}): DailySpendDay[] {
  const month = days === 29 ? "2024-02" : days === 28 ? "2026-02" : days === 30 ? "2026-04" : "2026-07";
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    return {
      date: `${month}-${String(day).padStart(2, "0")}`,
      day,
      value: values[day] ?? 0,
    };
  });
}

describe("DayBars", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a focusable group per day with sparse labels including final day", () => {
    const data = seriesForMonth(31, { 1: 10, 31: 20 });
    const { container } = render(<DayBars data={data} ariaLabel="Daily spend test" />);

    expect(screen.getByRole("group", { name: "Daily spend test" })).toBeInTheDocument();
    const labeled = container.querySelectorAll("g[aria-label]");
    expect(labeled).toHaveLength(31);

    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("1");
    expect(texts).toContain("5");
    expect(texts).toContain("31");
    // day 2 is not in sparse set
    expect(texts.filter((t) => t === "2")).toHaveLength(0);
    // final day not duplicated
    expect(texts.filter((t) => t === "31")).toHaveLength(1);
  });

  it("highlights today when highlight matches a zero day", () => {
    const data = seriesForMonth(31);
    const { container } = render(<DayBars data={data} highlight="2026-07-06" />);
    const todayGroup = Array.from(container.querySelectorAll("g[aria-label]")).find((g) =>
      g.getAttribute("aria-label")?.startsWith("6 Jul")
    );
    expect(todayGroup).toBeTruthy();
    const bar = todayGroup!.querySelector("rect[rx]") as SVGRectElement;
    expect(bar.getAttribute("fill")).toBe("var(--c-daily)");
  });

  it("shows date + amount tooltip on focus", () => {
    const data = seriesForMonth(31, { 3: 420 });
    const { container } = render(<DayBars data={data} />);
    const day3 = Array.from(container.querySelectorAll("g[aria-label]")).find((g) =>
      g.getAttribute("aria-label")?.includes("3 Jul")
    );
    expect(day3).toBeTruthy();
    fireEvent.focus(day3!);
    expect(screen.getByRole("tooltip")).toHaveTextContent(/3 Jul · ₹420/);
  });

  it("includes last day label for 28-day February without duplicate", () => {
    const data = seriesForMonth(28);
    const { container } = render(<DayBars data={data} />);
    const texts = Array.from(container.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("28");
    expect(texts.filter((t) => t === "28")).toHaveLength(1);
  });
});
