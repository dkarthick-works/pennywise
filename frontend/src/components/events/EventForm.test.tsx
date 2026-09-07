import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "./EventForm";
import { EventsApiError } from "../../api/events";
import { eventFixture } from "../../test/eventFixture";
import type { PlannedEventDetail } from "../../api/events";

function mount(event?: PlannedEventDetail, save = vi.fn().mockResolvedValue(eventFixture()), reload = vi.fn().mockResolvedValue(eventFixture({ version: 2 }))) {
  const view = render(<MemoryRouter initialEntries={["/edit"]}><Routes><Route path="/edit" element={<EventForm event={event} onSave={save} onReload={reload} returnPath="/events" />} /><Route path="/events/:id" element={<p>Saved detail</p>} /><Route path="/events" element={<p>Events list</p>} /></Routes></MemoryRouter>);
  return { ...view, save, reload };
}
afterEach(() => vi.restoreAllMocks());
describe("EventForm", () => {
  it("creates a named empty plan with defaults", async () => {
    const { save } = mount(); fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "New plan" } });
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await screen.findByText("Saved detail");
    expect(save).toHaveBeenCalledWith({ name: "New plan", note: "", target_date: null, status: "planned", suggestions_enabled: true, items: [] });
  });
  it("saves zero actual distinctly from unknown and retains item ID/version", async () => {
    const { save } = mount(eventFixture());
    fireEvent.change(screen.getByLabelText("Actual incurred so far"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" })); await screen.findByText("Saved detail");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ version: 1, items: [{ id: "item-1", name: "Service bill", expected_cost: 8000.25, actual_cost: 0 }] }));
  });
  it("reorders retained rows without moving IDs and supports new rows", async () => {
    const event = eventFixture(); event.items.push({ id: "item-2", name: "Second", expected_cost: null, actual_cost: null, position: 1 });
    const { save } = mount(event);
    fireEvent.click(screen.getByRole("button", { name: "Move item 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Save event" })); await screen.findByText("Saved detail");
    expect(save.mock.calls[0][0].items.map((i: { id: string }) => i.id)).toEqual(["item-2", "item-1"]);
  });
  it("keeps draft and original version after a conflict until explicit reload", async () => {
    const save = vi.fn().mockRejectedValue(new EventsApiError("changed", 409));
    const { reload } = mount(eventFixture(), save);
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "My unsaved name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    await screen.findByRole("alert"); expect(screen.getByLabelText("Event name")).toHaveValue("My unsaved name");
    expect(screen.getByRole("button", { name: "Save event" })).toBeDisabled();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard draft and reload" }));
    await waitFor(() => expect(screen.getByLabelText("Event name")).toHaveValue("Car service"));
    expect(reload).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Save event" })).not.toBeDisabled();
  });
  it("ignores changed query props while editing", () => {
    const save = vi.fn();
    const props = { onSave: save, returnPath: "/events" };
    const view = render(<MemoryRouter><EventForm {...props} event={eventFixture()} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Draft" } });
    view.rerender(<MemoryRouter><EventForm {...props} event={eventFixture({ name: "Remote", version: 9 })} /></MemoryRouter>);
    expect(screen.getByLabelText("Event name")).toHaveValue("Draft");
  });
  it("guards sidebar exits and cancellation with a dirty draft", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); mount();
    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Draft" } });
    expect(window.dispatchEvent(new Event("events:before-navigate", { cancelable: true }))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Event name")).toHaveValue("Draft"); expect(confirm).toHaveBeenCalledTimes(2);
  });
  it("displays backend completion errors without changing the chosen status", async () => {
    mount(eventFixture(), vi.fn().mockRejectedValue(new EventsApiError("completed events require actual cost for every item", 400)));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("require actual cost");
    expect(screen.getByLabelText("Status")).toHaveValue("completed");
  });
});
