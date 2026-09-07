import { expect, test } from "@playwright/test";

const profile = {
  user_id: "user-1",
  email: "user@example.com",
  display_name: "User",
};

test("two PWA pages share one rotating refresh", async ({ context }) => {
  let refreshRequests = 0;
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/refresh") {
      refreshRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 75));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ access_token: "shared-token" }),
      });
      return;
    }
    if (path === "/api/me") {
      await route.fulfill({ status: 200, json: profile });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });

  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto("/record"), second.goto("/record")]);
  await Promise.all([
    first.waitForFunction(() => sessionStorage.getItem("pennywise_access_token") === "shared-token"),
    second.waitForFunction(() => sessionStorage.getItem("pennywise_access_token") === "shared-token"),
  ]);

  expect(refreshRequests).toBe(1);
});

test("logout suppresses a late API-triggered refresh", async ({ context }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem("pennywise_access_token", "stored-token");
  });

  let rejectEventRequests = false;
  let releaseRefresh!: () => void;
  const refreshReleased = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let markRefreshStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    markRefreshStarted = resolve;
  });

  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/refresh") {
      markRefreshStarted();
      await refreshReleased;
      await route.fulfill({
        status: 200,
        json: { access_token: "late-token" },
      });
      return;
    }
    if (path === "/api/events") {
      await route.fulfill(rejectEventRequests
        ? { status: 401, json: { error: "expired token" } }
        : { status: 200, json: { events: [], limit: 50, offset: 0, has_more: false } });
      return;
    }
    if (path === "/api/auth/logout") {
      await route.fulfill({ status: 200, json: {} });
      return;
    }
    if (path === "/api/me") {
      await route.fulfill({ status: 200, json: profile });
      return;
    }
    await route.fulfill({ status: 200, json: {} });
  });

  const page = await context.newPage();
  await page.goto("/events");
  await expect(page.getByText(/No events yet/)).toBeVisible();
  rejectEventRequests = true;
  // A normal API request returning 401, rather than visibility, starts refresh.
  await page.getByLabel("Status", { exact: true }).selectOption("planned");
  await refreshStarted;

  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  releaseRefresh();

  await expect.poll(() =>
    page.evaluate(() => sessionStorage.getItem("pennywise_access_token"))
  ).toBeNull();
});

test("an expired API token refreshes once without reloading the profile", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("pennywise_access_token", "expired-token"));
  let meRequests = 0;
  let refreshRequests = 0;
  let eventRequests = 0;
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/me") { meRequests++; return route.fulfill({ json: profile }); }
    if (path === "/api/auth/refresh") { refreshRequests++; return route.fulfill({ json: { access_token: "fresh-token" } }); }
    if (path === "/api/events") {
      eventRequests++;
      if (request.headers()["authorization"] !== "Bearer fresh-token") return route.fulfill({ status: 401, json: { error: "expired token" } });
      return route.fulfill({ json: { events: [], limit: 50, offset: 0, has_more: false } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/events");
  await expect(page.getByText(/No events yet/)).toBeVisible();
  expect(refreshRequests).toBe(1);
  expect(meRequests).toBe(1);
  expect(eventRequests).toBe(2);
});
