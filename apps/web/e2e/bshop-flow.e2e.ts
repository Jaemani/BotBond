import { expect, test } from "@playwright/test";

test("human shopper can complete the normal BShop checkout", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NovaBook Air" })).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Your cart")).toBeVisible();
  await page.getByRole("button", { name: "Checkout" }).click();
  await expect(page.getByRole("heading", { name: "NovaBook Air is yours." })).toBeVisible();
});

test("unknown agent is blocked, then receives bounded access", async ({ page }) => {
  await page.goto("/?surface=agent");
  await expect(page.getByText("403 Forbidden")).toBeVisible();
  await page.getByRole("button", { name: "Request private data" }).click();
  await page.getByRole("button", { name: /Request bounded access/ }).click();
  await page.getByRole("button", { name: /Compile access contract/ }).click();
  await expect(page.getByText("/seller-contacts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Lock .* open session/ }).click();
  await expect(page.getByText("SESSION ACTIVE")).toBeVisible();
  await page.getByRole("button", { name: /Run scoped requests/ }).click();
  await expect(page.getByRole("heading", { name: "Task complete. Bond returned." })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Merchant Ops" }).click();
  await expect(page.getByText("/seller-contacts")).toBeVisible();
  await expect(page.getByText("Blocked before origin; no protected data leaves BShop.")).toBeVisible();
});

test("abandoned final-unit hold restores inventory and settles only the ceiling", async ({ page }) => {
  await page.goto("/?surface=agent");
  await page.getByRole("button", { name: "Abandon last-unit hold" }).click();
  await page.getByRole("button", { name: /Request bounded access/ }).click();
  await page.getByRole("button", { name: /Compile access contract/ }).click();
  await page.getByRole("button", { name: /Lock .* open session/ }).click();
  await page.getByRole("button", { name: /Run scoped requests/ }).click();
  await expect(page.getByRole("heading", { name: "Inventory recovered. Penalty bounded." })).toBeVisible({ timeout: 35_000 });
  await expect(page.getByText("0.25 USDC", { exact: true })).toBeVisible();
  await expect(page.getByText("0.75 USDC", { exact: true })).toBeVisible();
});
