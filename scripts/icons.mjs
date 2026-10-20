// Renders the extension icon at each size from one SVG.
import { chromium } from "@playwright/test";

const svg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#4048c9"/>
  <rect x="5.5" y="5.5" width="21" height="21" rx="2" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="1.6" stroke-dasharray="3 2.6"/>
  <path d="M9 23.5L19 13.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M21.5 6.5l1.1 2.5 2.5 1.1-2.5 1.1-1.1 2.5-1.1-2.5-2.5-1.1 2.5-1.1z" fill="#fff"/>
</svg>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size)}</body>`);
  await page.locator("svg").screenshot({ path: `extension/icons/${size}.png`, omitBackground: true });
}
await browser.close();
console.log("icons written");
