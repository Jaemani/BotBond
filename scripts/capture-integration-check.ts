import { chromium } from "@playwright/test";

const output = process.argv[2] ?? "docs/audit/final-product/09-live-integration-check.png";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto("https://botbond-bshop.vercel.app/integrate", { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("button", { name: "Run connection check" }).click();
  await page.getByText("pay.sh payment gate").waitFor({ timeout: 30_000 });
  await page.getByText("402", { exact: true }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}

console.log(`Captured ${output}`);
