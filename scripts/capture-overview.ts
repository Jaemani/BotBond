import { chromium } from "@playwright/test";

const output = process.argv[2] ?? "docs/audit/final-product/11-botbond-overview.png";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto("https://botbond-bshop.vercel.app/", { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Safe API access for unknown AI agents." }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}

console.log(`Captured ${output}`);
