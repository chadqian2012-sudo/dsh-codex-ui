import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startBrowserFixture, resolveDependency } from './browser-fixture.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'preview/screenshots/v1.2.0');
const require = createRequire(import.meta.url);
const { chromium } = require(resolveDependency('playwright', 'index.js'));
const fixture = await startBrowserFixture();
let browser;
const captures = new Map();
await fs.mkdir(out, { recursive: true });
async function open(page, theme) {
  await page.goto(fixture.url);
  await page.waitForFunction(() => window.__registration && window.__applyPlugin);
  await page.evaluate((dark) => {
    document.body.dataset.theme = dark ? 'dark' : 'light';
    document.body.toggleAttribute('data-ds-dark-theme', dark);
    window.__applyPlugin();
  }, theme === 'dark');
  await page.waitForSelector('[data-ces-part="anchor"]', { state: 'attached' });
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.waitForSelector('[data-ces-menu="root"]');
}
const levels = [
  { label: 'Off', id: 'off' },
  { label: 'Low', id: 'low' },
  { label: 'Medium', id: 'low' },
  { label: 'High', id: 'high' },
  { label: 'XHigh', id: 'high' },
  { label: 'Max', id: 'max' },
  { label: 'Ultra', id: 'max' },
];
async function effort(page, index) {
  const slider = page.locator('[data-ces-part="track"]');
  await slider.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < index; i += 1) await page.keyboard.press('ArrowRight');
  const { label, id } = levels[index];
  await page.waitForFunction((value) => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === value, `${label} (${id})`);
  await page.waitForTimeout(350);
}
try {
  browser = await chromium.launch({ executablePath: fixture.executablePath, headless: true });
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
    await open(page, theme);
    for (let i = 0; i < levels.length; i += 1) {
      await effort(page, i);
      const { label } = levels[i];
      const image = await page.locator('[data-ces-menu="root"]').screenshot({ path: path.join(out, `${theme}-${label.toLowerCase()}.png`) });
      captures.set(`${theme}-${label.toLowerCase()}`, image);
    }
    await effort(page, 3);
    await page.locator('[data-ces-part="boost"]').click();
    await page.waitForSelector('[data-ces-part="dust"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'idle');
    const grayBoost = await page.locator('[data-ces-menu="root"]').screenshot({ path: path.join(out, `${theme}-high-boost.png`) });
    captures.set(`${theme}-high-boost`, grayBoost);
    await page.locator('[data-ces-part="boost"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-part="dust"]'));
    await effort(page, 6);
    await page.locator('[data-ces-part="boost"]').click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'show-hint');
    await page.waitForTimeout(220);
    await page.locator('[data-ces-menu="root"]').screenshot({ path: path.join(out, `${theme}-fast-notice.png`) });
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'idle');
    const ultraBoost = await page.locator('[data-ces-menu="root"]').screenshot({ path: path.join(out, `${theme}-ultra-boost.png`) });
    captures.set(`${theme}-ultra-boost`, ultraBoost);
    await page.locator('[data-ces-part="boost"]').click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'false');
    await page.locator('[data-ces-row="model"]').click();
    await page.waitForSelector('[data-ces-menu="models"]');
    const image = await page.locator('[data-ces-menu="models"]').screenshot({ path: path.join(out, `${theme}-models.png`) });
    captures.set(`${theme}-models`, image);
    await page.close();
  }

  const gallery = await browser.newPage({ viewport: { width: 856, height: 950 }, deviceScaleFactor: 1.5 });
  const card = (theme, id) => `<section class="${theme}"><div class="label">${theme === 'light' ? '浅色' : '深色'} · ${id === 'models' ? '模型列表' : id === 'high-boost' ? 'High 蓝色灰尘 boost' : id === 'ultra-boost' ? 'Ultra 紫色星尘 boost' : id.toUpperCase()}</div><img src="data:image/png;base64,${captures.get(`${theme}-${id}`).toString('base64')}" /></section>`;
  await gallery.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#eceef2;color:#24262a;font:14px system-ui,'Microsoft YaHei',sans-serif}h1{font-size:22px;margin:0 0 6px;font-weight:600}p{margin:0 0 20px;color:#777;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{padding:12px;border-radius:20px;background:#f4f5f7;overflow:hidden}section.dark{background:#17181b}.label{font-size:12px;color:#888;margin:0 4px 10px}img{display:block;width:100%;height:auto}</style><h1>DeepSeek Harness · 1.2.0</h1><p>七档界面映射四个 DSH native effort ID · Ultra 紫色星场与 High 蓝色灰尘 boost 对比 · 使用实际插件渲染与 DSH 原生菜单样式</p><div class="grid">${['high', 'high-boost', 'ultra', 'ultra-boost', 'models'].map((id) => card('light', id) + card('dark', id)).join('')}</div>`);
  await gallery.locator('img').last().waitFor();
  await gallery.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  const size = await gallery.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await gallery.setViewportSize({ width: 856, height: size });
  await gallery.screenshot({ path: path.join(out, 'overview.png'), fullPage: true });
  await gallery.close();

  // Fixed physical viewport with adjusted CSS viewport/DPR models desktop zoom.
  for (const scale of [1, 1.25, 1.5]) {
    const page = await browser.newPage({ viewport: { width: Math.floor(1280 / scale), height: Math.floor(900 / scale) }, deviceScaleFactor: scale });
    await open(page, 'light');
    const box = await page.locator('[data-ces-menu="root"]').boundingBox();
    const width = page.viewportSize().width;
    if (!box || box.x < 0 || box.x + box.width > width + 1) throw new Error(`Menu overflow at equivalent zoom ${scale}`);
    await page.screenshot({ path: path.join(out, `zoom-${Math.round(scale * 100)}.png`) });
    await page.close();
  }
  console.log('Captured all seven display levels, High gray-dust and Ultra purple boost comparisons, model menus, overview, and 100/125/150% equivalent zoom.');
} finally {
  await browser?.close();
  await new Promise((resolve) => fixture.server.close(resolve));
}
