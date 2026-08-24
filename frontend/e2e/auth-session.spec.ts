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

test("logout suppresses a late visibility refresh", async ({ context }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem("pennywise_access_token", "stored-token");
  });

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
  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await refreshStarted;

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  releaseRefresh();

  await expect.poll(() =>
    page.evaluate(() => sessionStorage.getItem("pennywise_access_token"))
  ).toBeNull();
});
