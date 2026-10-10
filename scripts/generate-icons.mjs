import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(root, '.browser-cache');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const icon = await readFile(path.join(root, 'src/icons/icon.svg'), 'utf8');
const iconUrl = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;
try {
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${iconUrl}" alt="Job Lens">`);
    await page.locator('img').evaluate(img => img.decode());
    await page.screenshot({ path: path.join(root, `src/icons/icon-${size}.png`), omitBackground: true });
  }
} finally { await browser.close(); }
console.log('Generated extension icons in src/icons. Run npm run build to include them.');
