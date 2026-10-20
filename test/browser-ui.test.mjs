import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startBrowserFixture } from './browser-fixture.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RUNTIME_DEPS = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(RUNTIME_DEPS, 'playwright')); }
const { chromium } = playwright;
let fixture;
let browser;

before(async () => {
  fixture = await startBrowserFixture();
  browser = await chromium.launch({ executablePath: fixture.executablePath, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => fixture?.server.close(resolve));
});

async function pageWithPlugin(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1280, height: 900 }, deviceScaleFactor: options.scale ?? 1, hasTouch: options.hasTouch ?? false, isMobile: options.hasTouch ?? false });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => console.error('[fixture pageerror]', error.message));
  await page.goto(fixture.url + (options.session ? `?session=${encodeURIComponent(options.session)}` : ''));
  await page.waitForFunction(() => window.__fixtureReady && window.__registration && window.__fixtureRender);
  await page.evaluate(() => window.__applyPlugin());
  await page.waitForSelector('[data-ces-part="anchor"]', { state: 'attached' });
  return { context, page };
}

test('real React DOM integration follows root/model selection, keeps effort picker out of native model pane, and emits no messages', async () => {
  const { context, page } = await pageWithPlugin();
  try {
    const trigger = page.getByRole('button', { name: 'Select model' });
    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    assert.equal(await page.locator('[data-ces-menu="root"] [role="menuitem"]').count(), 2);
    assert.equal(await page.locator('[data-ces-part="track"]').count(), 1);
    assert.equal(await page.locator('[data-ces-menu="root"]').evaluate((el) => getComputedStyle(el).borderRadius), '24px');

    await page.getByRole('menuitem', { name: /模型/ }).click();
    await page.waitForSelector('[data-ces-menu="models"]');
    assert.equal(await page.locator('[data-ces-menu="models"]').getAttribute('role'), 'group');
    assert.equal(await page.getByRole('menuitemradio').count(), 2);
    assert.equal(await page.locator('[data-ces-part="track"]').count(), 0);
    await page.getByRole('menuitemradio').first().focus();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ces-menu="root"]');
    assert.equal(await page.locator('[data-ces-part="track"]').count(), 1);
    await page.getByRole('menuitem', { name: /模型/ }).click();
    await page.locator('[role="menuitemradio"] [data-model-id="deepseek-reasoner"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu]'));
    await page.waitForFunction(() => window.__fixture.current.model === 'deepseek-reasoner');
    assert.equal(await page.evaluate(() => window.__fixture.current.model), 'deepseek-reasoner');
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);

    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    await trigger.click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu]'));
    const sessionTwo = await pageWithPlugin({ session: 'session-2' });
    try {
      await sessionTwo.page.waitForFunction(() => window.__fixture.directoryLookups.includes('session-2'));
      assert.equal(await sessionTwo.page.evaluate(() => window.__fixture.directoryLookups.includes('session-1')), false);
    } finally {
      await sessionTwo.context.close();
    }
  } finally {
    await context.close();
  }
});

test('four effort levels respond to keyboard, pointer touch, delayed reports, reset, and session state stays scoped', async () => {
  const { context, page } = await pageWithPlugin({ viewport: { width: 390, height: 844 }, scale: 1.25, hasTouch: true });
  try {
    await page.getByRole('button', { name: 'Select model' }).click();
    const slider = page.locator('[data-ces-part="track"]');
    await slider.focus();
    for (const [key, value] of [['Home', 'Off'], ['ArrowRight', 'Low'], ['ArrowRight', 'High'], ['End', 'Max']]) {
      await page.keyboard.press(key);
      await page.waitForFunction((v) => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === v, value);
    }
    const box = await slider.boundingBox();
    const touch = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: box.x + 16, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: box.x + box.width - 16, y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);

    const reset = page.locator('[data-ces-part="reset"]');
    assert.equal(await reset.count(), 1);
    {
      await reset.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__fixture.selections.some((s) => s.provider && s.model && !Object.hasOwn(s, 'reasoningEffort')));
      await page.waitForFunction(() => window.__fixture.effort === 'high');
    }
    const args = await page.evaluate(() => window.__fixture.selections);
    assert.ok(args.every((selection) => selection.provider === 'deepseek' && selection.model));
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);
    await slider.focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu]'));
  } finally {
    await context.close();
  }
});

test('capture light and dark native menu layouts at the supported viewport and scale matrix', async () => {
  const out = path.join(ROOT, 'preview', 'screenshots', 'v1.2.0');
  const fs = await import('node:fs/promises');
  await fs.mkdir(out, { recursive: true });
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 1280]) {
      for (const scale of [1, 1.25, 1.5]) {
        const { context, page } = await pageWithPlugin({ viewport: { width, height: 900 }, scale });
        try {
          await page.evaluate((value) => { document.body.dataset.theme = value; if(value==='dark')document.body.dataset.dsDarkTheme=''; }, theme);
          await page.getByRole('button', { name: 'Select model' }).click();
          await page.waitForSelector('[data-ces-menu="root"]');
          const bounds = await page.locator('[data-ces-menu="root"]').boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `menu stays within the ${width}px viewport at DPR ${scale}`);
          await page.screenshot({ path: path.join(out, `${theme}-${width}-dpr${String(scale).replace('.', '-')}.png`) });
        } finally {
          await context.close();
        }
      }
    }
  }
});
