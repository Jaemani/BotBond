import { chromium } from "@playwright/test";

const signature = process.argv[2] ?? "4kkFpZNN3DNzDEYqTuA9eXd7fsYv6kUvZRRV7posqddUUviFxWFvTJdKPRTDskdcFKNJnwFxZQBTzJR5Zoj3m961";
const output = process.argv[3] ?? "docs/audit/final-product/12-solana-explorer-bond-open.png";
const url = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(8_000);
  await page.screenshot({ path: output, fullPage: true });
} finally {
  await browser.close();
}

console.log(`Captured ${output}`);
