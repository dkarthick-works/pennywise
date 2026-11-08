import { expect, test } from "@playwright/test";
import type { SMSDraft } from "../src/api/sms";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`SMS review workflow — ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => sessionStorage.setItem("pennywise_access_token", "sms-test-token"));
    let drafts: SMSDraft[] = [{ id: "draft-1", source_sms_id: "source-1", revision: 1, category: "Card payment", amount: 2340.5, date: "2026-04-15", section: null, kind: "cash", currency: "INR", direction: "debit", event_type: "settlement", warnings: ["possible_settlement_review", "cash_defaulted"], possible_duplicate: true }];
    const writes: unknown[] = [];
    let failed = true;
    await page.route("**/api/**", async (route) => {
      const req = route.request(); const path = new URL(req.url()).pathname;
      if (path === "/api/me") return route.fulfill({ json: { user_id: "test", email: "test@example.com", display_name: "Test" } });
      if (path === "/api/sms/drafts" && req.method() === "GET") return route.fulfill({ json: { drafts, next_offset: null } });
      if (path === "/api/sms/jobs") return route.fulfill({ json: failed ? [{ id: "job-1", status: "failed", failed_stage: "extraction", error_code: "provider_timeout" }] : [] });
      if (path.endsWith("/retry")) { failed = false; return route.fulfill({ status: 204 }); }
      if (path === "/api/sms/drafts/draft-1" && req.method() === "PUT") {
        const input = req.postDataJSON();
        expect(input.revision).toBe(drafts[0].revision);
        drafts = [{ ...drafts[0], ...input, revision: drafts[0].revision + 1 }];
        return route.fulfill({ status: 204 });
      }
      if (path === "/api/transactions" && req.method() === "POST") {
        const input = req.postDataJSON();
        expect(input.sms_draft_id).toBe("draft-1"); expect(input.sms_draft_revision).toBe(2);
        writes.push(input); drafts = [];
        return route.fulfill({ status: 201, json: { ...input, id: "transaction-1" } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto("/sms-drafts");
    await expect(page.getByRole("heading", { name: "SMS Drafts", exact: true })).toBeVisible();
    await expect(page.getByText(/Possible card bill payment/)).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.getByRole("button", { name: "Approve and save Transaction" }).click();
    await expect(page.getByRole("alert")).toHaveText("Choose a section before approval.");
    await page.getByLabel("Section", { exact: true }).selectOption("daily");
    await page.getByLabel("Transaction name").fill("Reviewed purchase");
    await page.getByRole("button", { name: "Save draft edits" }).click();
    await expect(page.getByText("Draft edits saved. Nothing was added to your ledger.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reviewed purchase" })).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.screenshot({ path: testInfo.outputPath(`sms-${viewport.name}-controls.png`), fullPage: true });
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector(".main")?.scrollTo(0, 0); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sms-${viewport.name}.png`), fullPage: true });
    await page.getByRole("button", { name: "Approve and save Transaction" }).click();
    await expect(page.getByRole("heading", { name: "No drafts to review" })).toBeVisible();
    expect(writes).toHaveLength(1);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("No failed jobs.")).toBeVisible();
    if (viewport.name === "mobile") await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("button", { name: "SMS Drafts", exact: true })).toBeVisible();
  });
}
