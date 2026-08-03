import { chromium } from "@playwright/test";

const output = process.argv[2] ?? "docs/audit/final-product/08-live-direct-403.png";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto("https://botbond-bshop.vercel.app/agent", { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("button", { name: "Send request to deployed gateway" }).click();
  await page.getByText("403 Forbidden").waitFor({ timeout: 30_000 });
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}

console.log(`Captured ${output}`);
