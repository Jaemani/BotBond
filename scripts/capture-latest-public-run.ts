import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const state = JSON.parse(readFileSync(".secrets/latest-public-run.json", "utf8")) as { webUrl: string };
const output = process.argv[2] ?? "docs/audit/final-product/05-live-receipt.png";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(state.webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Settlement receipt").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}
console.log(`Captured ${output}`);
