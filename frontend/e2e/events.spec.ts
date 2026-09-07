import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { EventInput, PlannedEventDetail } from "../src/api/events";

async function mockEvents(page: Page) {
  const events = new Map<string, PlannedEventDetail>();
  let sequence = 0;
  const financialWrites: string[] = [];
  const authRequests = { me: 0, refresh: 0 };
  await page.addInitScript(() => sessionStorage.setItem("pennywise_access_token", "events-test-token"));
  await page.route("**/api/**", async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    if (path === "/api/me") { authRequests.me++; return route.fulfill({ json: { user_id: "test", email: "test@example.com", display_name: "Test" } }); }
    if (path === "/api/auth/refresh") { authRequests.refresh++; return route.fulfill({ json: { access_token: "events-test-token" } }); }
    if (path.startsWith("/api/transactions") && request.method() !== "GET") financialWrites.push(path);
    if (!path.startsWith("/api/events")) return route.fulfill({ json: {} });
    if (path === "/api/events" && request.method() === "GET") {
      const status = url.searchParams.get("status"); const offset = Number(url.searchParams.get("offset") || 0);
      const list = [...events.values()].filter(e => !status || e.status === status);
      return route.fulfill({ json: { events: list.slice(offset, offset + 50), limit: 50, offset, has_more: list.length > offset + 50 } });
    }
    const id = path.split("/")[3]; const old = events.get(id);
    if (path !== "/api/events" && !old) return route.fulfill({ status: 404, json: { error: "event not found" } });
    if (request.method() === "GET") return route.fulfill({ json: old });
    if (request.method() === "DELETE") {
      expect(request.headers()["if-match"]).toBe(`"${old!.version}"`);
      events.delete(id); return route.fulfill({ status: 204 });
    }
    const body = request.postDataJSON();
    if (request.method() === "PUT" && body.version !== old!.version) return route.fulfill({ status: 409, json: { error: "event changed; reload before saving" } });
    let input: EventInput = body;
    const copying = path.endsWith("/duplicate");
    if (copying) input = { ...old!, name: body.name || `${old!.name} (copy)`, status: "planned", target_date: body.target_date || null, items: old!.items.map(i => ({ name: i.name, expected_cost: i.expected_cost, actual_cost: null })) };
    if (input.status === "completed" && (!input.items.length || input.items.some(i => i.actual_cost === null))) return route.fulfill({ status: 400, json: { error: "completed events require actual cost for every item" } });
    const eventID = request.method() === "PUT" ? id : `event-${++sequence}`;
    const items = input.items.map((i, position) => ({ ...i, id: i.id || `${eventID}-item-${position}`, position }));
    const complete = items.length > 0 && items.every(i => i.actual_cost !== null);
    const event: PlannedEventDetail = {
      id: eventID, name: input.name, note: input.note || "", target_date: input.target_date || null, status: input.status || "planned", suggestions_enabled: input.suggestions_enabled ?? true,
      version: request.method() === "PUT" ? old!.version + 1 : 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), items,
      summary: { item_count: items.length, expected_total: items.reduce((sum, i) => sum + (i.expected_cost ?? 0), 0), actual_total: items.reduce((sum, i) => sum + (i.actual_cost ?? 0), 0), missing_expected_count: items.filter(i => i.expected_cost === null).length, missing_actual_count: items.filter(i => i.actual_cost === null).length, budget_complete: items.length > 0 && items.every(i => i.expected_cost !== null), actuals_complete: complete, can_complete: complete },
    };
    events.set(eventID, event);
    return route.fulfill({ status: request.method() === "PUT" ? 200 : 201, json: event });
  });
  return { events, financialWrites, authRequests };
}

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`Events CRUD workflow — ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const { events, financialWrites } = await mockEvents(page);
    page.on("dialog", dialog => dialog.accept());
    await page.goto("/events");
    if (viewport.name === "mobile") await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Events", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Events", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "+ Create event", exact: true }).click();
    await page.getByLabel("Event name", { exact: true }).fill("Vehicle service");
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.getByRole("button", { name: "+ Add item", exact: true }).click();
    await page.getByLabel("Item name", { exact: true }).fill("Service bill");
    await page.getByLabel("Expected cost", { exact: true }).fill("8000.25");
    await page.getByRole("button", { name: "Create event", exact: true }).click();
    await expect(page).toHaveURL(/\/events\/event-1$/);
    await expect(page.getByRole("button", { name: "Complete event", exact: true })).toBeDisabled();
    await expect(page.getByText("Not entered", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit event", exact: true }).click();
    await page.getByLabel("Actual incurred so far", { exact: true }).fill("0");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(page).toHaveURL(/\/events\/event-1$/);
    await page.getByRole("button", { name: "Complete event", exact: true }).click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    expect(events.get("event-1")?.items[0].actual_cost).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("event-detail.png"), fullPage: true });
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.getByRole("button", { name: "Create copy", exact: true }).click();
    await expect(page).toHaveURL(/\/events\/event-2\/edit$/);
    await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("Vehicle service (copy)");
    await expect(page.getByLabel("Actual incurred so far", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Status", { exact: true })).toHaveValue("planned");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/\/events\/event-2$/);
    await page.getByRole("button", { name: "Delete event", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.getByRole("link", { name: "Vehicle service", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vehicle service (copy)", exact: true })).toHaveCount(0);
    expect(financialWrites).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("a stale event draft requires explicit reload", async ({ page }) => {
  const { events } = await mockEvents(page); page.on("dialog", dialog => dialog.accept());
  await page.goto("/events/new");
  await page.getByLabel("Event name", { exact: true }).fill("Original");
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await expect(page).toHaveURL(/\/events\/event-1$/);
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("Original");
  const event = events.get("event-1")!; events.set(event.id, { ...event, name: "Changed elsewhere", version: 2 });
  await page.getByLabel("Event name", { exact: true }).fill("My draft");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("My draft");
  await expect(page.getByRole("button", { name: "Save event", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Discard draft and reload", exact: true }).click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("Changed elsewhere");
});

test("tab switches and cross-tab tokens preserve an unsaved event without auth requests", async ({ page, context }) => {
  const { authRequests } = await mockEvents(page);
  await page.goto("/events/new");
  await page.getByLabel("Event name", { exact: true }).fill("Unsaved service plan");
  expect(authRequests).toEqual({ me: 1, refresh: 0 });
  const other = await context.newPage();
  for (let i = 0; i < 3; i++) {
    await other.bringToFront();
    await page.bringToFront();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  }
  await page.evaluate(() => {
    sessionStorage.setItem("pennywise_access_token", "token-from-another-tab");
    window.dispatchEvent(new Event("auth:token"));
  });
  // Allow the event handlers and any accidental network requests to settle.
  await page.waitForTimeout(200);
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("Unsaved service plan");
  expect(authRequests).toEqual({ me: 1, refresh: 0 });
  await other.close();
});
