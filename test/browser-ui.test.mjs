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
  if (options.oldSettings) {
    await context.addInitScript(() => localStorage.setItem('dsh-codex-effort-slider.settings', JSON.stringify({ v: 1, motion: 'fast', reachedTicks: 'dim', legacyGlow: true })));
  }
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => console.error('[fixture pageerror]', error.message));
  await page.goto(fixture.url + '?' + new URLSearchParams({ ...(options.session ? { session: options.session } : {}), ...(options.manyModels ? { manyModels: '1' } : {}) }));
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
    assert.equal(await page.locator('[data-ces-menu="root"]').evaluate((el) => getComputedStyle(el).borderRadius), '22px');

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

test('rc3 searchable model pane keeps its skin through filtering, empty results, keyboard selection and narrow layouts', async (t) => {
  if (!fixture.supportsModelSearch) return t.skip('Installed host has no model-search CSS exports');
  const { context, page } = await pageWithPlugin({ manyModels: true, viewport: { width: 320, height: 600 } });
  try {
    await page.getByRole('button', { name: 'Select model' }).click();
    await page.locator('[data-ces-row="model"]').click();
    const menu = page.locator('[data-ces-menu="models"]');
    const search = page.getByRole('searchbox');
    await search.waitFor();
    assert.equal(await page.getByRole('menuitemradio').count(), 5);
    assert.equal(await search.getAttribute('aria-controls'), 'official-model-session-1-models');
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark);
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 600, 'model pane fits narrow viewport in either theme');
    }
    await search.fill('no matching model');
    await page.getByRole('status').waitFor();
    assert.equal(await page.getByRole('menuitemradio').count(), 0);
    assert.equal(await menu.count(), 1, 'hidden but mounted native list identifies the empty model pane');
    assert.equal(await page.locator('[data-ces-part="track"]').count(), 0);
    await search.fill('R1');
    assert.equal(await page.getByRole('menuitemradio').count(), 1);
    const option = page.getByRole('menuitemradio');
    await search.press('ArrowDown');
    assert.equal(await option.evaluate(el => el === document.activeElement), true, 'host keyboard navigation retains focus');
    const optionBox = await option.boundingBox();
    const checkBox = await option.locator(':scope > span').last().boundingBox();
    assert.ok(optionBox.x + optionBox.width - checkBox.x - checkBox.width <= 12, 'native check stays at the right edge');
    assert.equal(await option.evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus remains visible');
    await page.screenshot({ path: path.join(ROOT, '.work', 'rc3-search-narrow.png') });
    await option.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu]'));
    await page.waitForFunction(() => window.__fixture.current.model === 'deepseek-reasoner');
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);
    assert.equal(await page.locator('[data-ces-part="header-host"], [data-ces-part="model-notice-host"]').count(), 0);
  } finally {
    await context.close();
  }
});

test('boost notice fades the native model row, restarts on rapid clicks, and cancels cleanly on close', async () => {
  const { context, page } = await pageWithPlugin();
  try {
    const trigger = page.getByRole('button', { name: 'Select model' });
    await trigger.click();
    const row = page.locator('[data-ces-menu="root"] [data-ces-row="model"]');
    const nativeParts = row.locator(':scope > [data-ces-native]');
    const boost = page.locator('[data-ces-part="boost"]');
    const notice = page.locator('[data-ces-part="model-notice"]');
    assert.equal(await notice.textContent(), '使用额度消耗更快');
    assert.equal(await boost.getAttribute('title'), null, 'boost has no hover tooltip');
    assert.equal(await boost.getAttribute('aria-label'), '开启快速动效');
    assert.equal(await nativeParts.first().evaluate((el) => getComputedStyle(el).opacity), '1');
    assert.match(await nativeParts.first().evaluate((el) => getComputedStyle(el).transitionDuration), /0\.18s/);

    await boost.click();
    await page.waitForTimeout(60);
    await boost.click();
    assert.equal(await boost.getAttribute('aria-label'), '开启快速动效');
    assert.equal(await notice.getAttribute('data-ces-notice'), 'idle', 'turning boost off immediately cancels the hint');
    await page.waitForTimeout(60);
    await boost.click();
    const secondEnableAt = await page.evaluate(() => performance.now());
    await page.waitForTimeout(100);
    assert.notEqual(await notice.getAttribute('data-ces-notice'), 'show-hint', 'off/on cancels the earlier timer and restarts the 180ms delay');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'show-hint');
    const shownAt = await page.evaluate(() => performance.now());
    assert.ok(shownAt - secondEnableAt >= 145, 'hint appears after the restarted enable delay');
    await page.waitForFunction(() => {
      const part = document.querySelector('[data-ces-part="model-notice"]');
      return part && getComputedStyle(part).opacity === '1';
    });
    await page.waitForFunction(() => {
      const parts = document.querySelectorAll('[data-ces-menu="root"] [data-ces-row="model"] > [data-ces-native]');
      return parts.length > 0 && [...parts].every((el) => getComputedStyle(el).opacity === '0');
    });
    assert.match(await notice.evaluate((el) => getComputedStyle(el).transitionDuration), /0\.18s/);

    // The overlay cannot intercept the host's actual model-row click.
    await row.click();
    await page.waitForSelector('[data-ces-menu="models"]');
    assert.equal(await page.locator('[data-ces-part="model-notice-host"]').count(), 0, 'switching to native models pane detaches the notice host');
    await page.getByRole('menuitemradio').first().focus();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-ces-menu="root"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'idle');

    // Disabling during another notice sequence cancels it and restores the native model row.
    await boost.click();
    assert.equal(await boost.getAttribute('aria-label'), '开启快速动效');
    assert.equal(await notice.getAttribute('data-ces-notice'), 'idle');
    await boost.click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'show-hint');
    await boost.click();
    assert.equal(await boost.getAttribute('aria-label'), '开启快速动效');
    assert.equal(await notice.getAttribute('data-ces-notice'), 'idle');
    await page.waitForFunction(() => {
      const parts = document.querySelectorAll('[data-ces-menu="root"] [data-ces-row="model"] > [data-ces-native]');
      return parts.length > 0 && [...parts].every((el) => getComputedStyle(el).opacity === '1');
    });

    // Start another sequence, then close while its hint is visible. Reopening must not replay an old timer.
    await boost.click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'show-hint');
    await trigger.click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu]'));
    assert.equal(await page.locator('[data-ces-part="host"], [data-ces-part="header-host"], [data-ces-part="model-notice-host"]').count(), 0, 'closing removes all three injected UI containers');

    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="model-notice"]')?.getAttribute('data-ces-notice') === 'idle');
    await page.waitForTimeout(1650);
    assert.equal(await notice.getAttribute('data-ces-notice'), 'idle', 'canceled timers do not change the reopened notice state');
    assert.equal(await page.locator('[data-ces-part="host"], [data-ces-part="header-host"], [data-ces-part="model-notice-host"]').count(), 3, 'reopened menu owns one fresh set of containers');
  } finally {
    await context.close();
  }
});

test('seven display levels map to native IDs, retain aliases, scope sessions, and keep boost visual-only', async () => {
  const { context, page } = await pageWithPlugin({ viewport: { width: 390, height: 844 }, scale: 1.25, hasTouch: true, oldSettings: true });
  try {
    const firstComposer = page.locator('[data-fixture-session="session-1"]');
    const trigger = firstComposer.getByRole('button', { name: 'Select model' });
    await trigger.click();
    const slider = page.locator('[data-ces-part="track"]');
    await slider.focus();
    assert.equal(await slider.getAttribute('aria-valuemax'), '6');
    assert.equal(await page.locator('[data-ces-part="tick"]').count(), 7);
    assert.equal(await slider.getAttribute('aria-valuetext'), 'High (high)');
    assert.equal(await page.locator('[data-ces-part="level"]').getAttribute('title'), 'High (high)');
    assert.deepEqual(await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('dsh-codex-effort-slider.settings'));
      return [s.v, s.motion, s.reachedTicks];
    }), [3, 'fast', 'dim'], 'legacy preferences should migrate while valid settings survive');

    // Simulate DSH's global superellipse and a host radius override; the knob stays round.
    await page.addStyleTag({ content: '@supports(corner-shape:superellipse(1.5)){:root{--dsw-corner-shape:superellipse(1.5)}*,:before,:after{corner-shape:var(--dsw-corner-shape)}}' });
    const shape = await page.locator('[data-ces-part="knob"]').evaluate((el) => {
      const css = getComputedStyle(el), box = el.getBoundingClientRect();
      const track = getComputedStyle(el.parentElement);
      return { width: box.width, height: box.height, radius: css.borderRadius, cornerShape: css.cornerShape, background: css.backgroundColor, trackCornerShape: track.cornerShape };
    });
    assert.deepEqual(shape, { width: 36, height: 36, radius: '50%', cornerShape: 'superellipse(1)', background: 'rgb(255, 255, 255)', trackCornerShape: 'superellipse(1)' });

    const root = page.locator('.ces-inline[data-ces-part="root"]');
    const boost = page.locator('[data-ces-part="boost"]');
    const lightning = await boost.evaluate((el) => {
      const css = getComputedStyle(el), icon = getComputedStyle(el.querySelector('svg'));
      return { background: css.backgroundColor, radius: css.borderRadius, cornerShape: css.cornerShape, fill: icon.fill, stroke: icon.stroke };
    });
    assert.equal(lightning.background, 'rgba(127, 127, 127, 0.08)');
    assert.equal(lightning.radius, '9px');
    assert.equal(lightning.cornerShape, 'superellipse(1)');
    assert.equal(lightning.fill, 'rgb(149, 149, 152)');
    assert.equal(lightning.stroke, 'none');
    const selectionsBeforeBoost = await page.evaluate(() => window.__fixture.selections.length);
    assert.equal(await boost.getAttribute('aria-pressed'), 'false');
    await boost.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await root.getAttribute('data-boost'), '1');
    assert.equal(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--ces-boost').trim()), '1.8');
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), selectionsBeforeBoost, 'boost must not submit a native effort selection');
    assert.equal(await page.locator('[data-ces-menu="root"]').count(), 1, 'boost activation must not trigger the native row');
    await boost.click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'false');
    await slider.focus();

    const expected = [
      { key: 'Home', label: 'Off', id: 'off', request: true },
      { key: 'ArrowRight', label: 'Low', id: 'low', request: true },
      { key: 'ArrowRight', label: 'Medium', id: 'low', request: false },
      { key: 'ArrowRight', label: 'High', id: 'high', request: true },
      { key: 'ArrowRight', label: 'XHigh', id: 'high', request: false },
      { key: 'ArrowRight', label: 'Max', id: 'max', request: true },
      { key: 'ArrowRight', label: 'Ultra', id: 'max', request: false },
    ];
    let requested = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const item = expected[index];
      await slider.focus();
      await page.keyboard.press(item.key);
      await page.waitForFunction(({ label, id }) => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === `${label} (${id})`, { label: item.label, id: item.id });
      if (item.request) {
        requested += 1;
        await page.waitForFunction((count) => window.__fixture.selections.length === count, requested);
      } else {
        await page.waitForTimeout(150);
        assert.equal(await page.evaluate(() => window.__fixture.selections.length), requested, `${item.label} is an alias of native ${item.id}`);
      }
      assert.equal(await slider.getAttribute('aria-valuenow'), String(index));
      assert.equal(await page.locator('[data-ces-part="level"]').getAttribute('title'), `${item.label} (${item.id})`);
      if (item.label === 'Ultra') {
        assert.equal(await root.getAttribute('data-energy'), '1', 'Ultra alone enables purple energy');
        assert.equal(await page.locator('[data-ces-part="fill"]').getAttribute('data-fill'), 'energy');
        assert.equal(await page.locator('[data-ces-part="level"]').evaluate((el) => getComputedStyle(el).color), 'rgb(139, 92, 246)');
        assert.ok(await page.locator('[data-ces-part="star"]').count() > 0, 'Ultra renders purple stars');
      } else {
        assert.equal(await root.getAttribute('data-energy'), '0', `${item.label} keeps purple energy off`);
        assert.equal(await page.locator('[data-ces-part="fill"]').getAttribute('data-fill'), item.label === 'Off' ? 'gray' : 'blue', `${item.label} fill remains gray/blue`);
        const expectedColor = item.label === 'Off' ? 'rgb(149, 149, 152)' : 'rgb(77, 127, 247)';
        assert.equal(await page.locator('[data-ces-part="level"]').evaluate((el) => getComputedStyle(el).color), expectedColor, `${item.label} uses its gray/blue text color`);
        assert.equal(await page.locator('[data-ces-part="star"]').count(), 0, `${item.label} has no purple stars`);
      }
      if (item.label === 'Off') {
        const count = await page.evaluate(() => window.__fixture.selections.length);
        await boost.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'true');
        assert.equal(await root.getAttribute('data-energy'), '0');
        assert.equal(await root.getAttribute('data-off'), '1');
        assert.equal(await page.locator('[data-ces-part="fill"]').getAttribute('data-fill'), 'gray');
        assert.equal(await page.locator('[data-ces-part="dust"]').count(), 0, 'Off remains static when visual boost is enabled');
        assert.equal(await page.locator('[data-ces-part="star"]').count(), 0);
        assert.equal(await page.evaluate(() => window.__fixture.selections.length), count);
        await boost.click();
        await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'false');
      }
    }
    assert.deepEqual(await page.evaluate(() => window.__fixture.selections.map((s) => s.reasoningEffort)), ['off', 'low', 'high', 'max']);
    assert.ok((await page.evaluate(() => window.__fixture.reports.map((r) => r.effort).filter(Boolean))).every((id) => ['off', 'low', 'high', 'max'].includes(id)), 'store reports must remain in the native four-ID domain');

    // A same-native-ID report and root menu reopen retain the selected Ultra alias.
    await page.evaluate(() => window.__fixture.report('max'));
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Ultra (max)');
    await slider.focus();
    const backwardSelectionStart = await page.evaluate(() => window.__fixture.selections.length);
    for (const label of ['Max', 'XHigh', 'High', 'Medium']) {
      await page.keyboard.press('ArrowLeft');
      const id = label === 'Ultra' || label === 'Max' ? 'max' : label === 'XHigh' || label === 'High' ? 'high' : 'low';
      await page.waitForFunction((value) => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === value, `${label} (${id})`);
    }
    await page.waitForFunction((count) => window.__fixture.selections.length === count, backwardSelectionStart + 2);
    await page.evaluate(() => window.__fixture.report('low'));
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Medium (low)');
    await trigger.click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu="root"]'));
    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Medium (low)');

    // Low gets only slow gray dust; its fill remains blue and the native ID stays low.
    const boostCountBeforeLow = await page.evaluate(() => window.__fixture.selections.length);
    await boost.focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await root.evaluate((el) => getComputedStyle(el).getPropertyValue('--ces-boost').trim()), '1.8');
    assert.equal(await page.locator('[data-ces-part="dust"]').count(), 7);
    const dustTransformBefore = await page.locator('[data-ces-part="dust"]').first().evaluate((el) => el.style.transform);
    await page.waitForTimeout(250);
    const dustTransformAfter = await page.locator('[data-ces-part="dust"]').first().evaluate((el) => el.style.transform);
    assert.notEqual(dustTransformAfter, dustTransformBefore, 'boosted low dust must move over time');
    assert.equal(await page.locator('[data-ces-part="fill"]').getAttribute('data-fill'), 'blue');
    assert.equal(await root.getAttribute('data-energy'), '0');
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), boostCountBeforeLow);
    await boost.click();
    await page.waitForFunction(() => document.querySelector('[data-ces-part="boost"]')?.getAttribute('aria-pressed') === 'false');
    assert.equal(await page.locator('[data-ces-part="dust"]').count(), 0, 'turning boost off removes low dust immediately');
    assert.equal(await page.locator('[data-ces-part="fill"]').getAttribute('data-fill'), 'blue');
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), boostCountBeforeLow);

    // The seven tick centers are evenly ordered across the track and touch input reaches the first alias.
    const box = await slider.boundingBox();
    const points = await page.locator('[data-ces-part="tick"]').evaluateAll((nodes) => nodes.map((el) => { const r = el.getBoundingClientRect(); return r.x + r.width / 2; }));
    assert.equal(points.length, 7);
    assert.ok(points.every((x, index) => index === 0 || x > points[index - 1]));
    const touch = await context.newCDPSession(page);
    const y = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: points[6], y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: points[0], y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Off (off)');
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);

    const reset = page.locator('[data-ces-part="reset"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="root"]')?.getAttribute('data-busy') === '0');
    await reset.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__fixture.selections.some((s) => s.provider && s.model && !Object.hasOwn(s, 'reasoningEffort')));
    await page.waitForFunction(() => window.__fixture.effort === 'high');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'High (high)');
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);

    // A reasoner model's native max default resets to its canonical Max alias.
    await trigger.click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu="root"]'));
    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    await page.getByRole('menuitem', { name: /模型/ }).click();
    await page.locator('[role="menuitemradio"] [data-model-id="deepseek-reasoner"]').click();
    await page.waitForFunction(() => window.__fixture.current.model === 'deepseek-reasoner' && window.__fixture.effort === 'max');
    await trigger.click();
    await page.waitForSelector('[data-ces-menu="root"]');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Max (max)');
    await slider.focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Off (off)');
    await page.locator('[data-ces-part="reset"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__fixture.selections.some((s) => s.model === 'deepseek-reasoner' && !Object.hasOwn(s, 'reasoningEffort')));
    await page.waitForFunction(() => window.__fixture.current.model === 'deepseek-reasoner' && window.__fixture.effort === 'max');
    await page.waitForFunction(() => document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Max (max)');

    // Two composers in the same page have independent directories, aliases, and selections.
    await trigger.click();
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu="root"]'));
    await page.evaluate(() => window.__mountSecondSession());
    await page.waitForFunction(() => document.querySelectorAll('[data-ces-part="anchor"]').length === 2);
    const secondComposer = page.locator('[data-fixture-session="session-2"]');
    await secondComposer.getByRole('button', { name: 'Select model' }).click();
    const secondTrack = page.locator('#official-model-session-2-menu [data-ces-part="track"]');
    await secondTrack.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => window.__fixtureSessions.get('session-2').effort === 'max');
    await page.waitForFunction(() => document.querySelector('#official-model-session-2-menu [data-ces-part="track"]')?.getAttribute('aria-valuetext') === 'Ultra (max)');
    await secondComposer.getByRole('button', { name: 'Select model' }).click();
    await trigger.click();
    await page.waitForSelector('#official-model-session-1-menu [data-ces-part="track"]');
    assert.equal(await slider.getAttribute('aria-valuetext'), 'Max (max)', 'session-2 must not change session-1 alias');
    assert.deepEqual(await page.evaluate(() => window.__fixtureSessions.get('session-2').selections.map((s) => s.reasoningEffort)), ['max']);
  } finally {
    await context.close();
  }
});

test('native pointer capture loss settles once, foreign pointers cannot take over, and Escape discards the drag', async () => {
  const { context, page } = await pageWithPlugin();
  try {
    await page.getByRole('button', { name: 'Select model' }).click();
    const slider = page.locator('[data-ces-part="track"]');
    await slider.focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => window.__fixture.effort === 'off');
    const before = await page.evaluate(() => window.__fixture.selections.length);
    const box = await slider.boundingBox();
    const right = box.x + box.width - 18;
    const left = box.x + 18;
    const y = box.y + box.height / 2;
    await slider.evaluate((el) => {
      el.addEventListener('pointerdown', (event) => { if (event.isTrusted) window.__testPointerId = event.pointerId; });
      window.__testLostCapture = 0;
      el.addEventListener('lostpointercapture', () => { window.__testLostCapture += 1; });
    });

    await page.mouse.move(right, y);
    await page.mouse.down();
    await page.mouse.move(right - 1, y);
    assert.equal(await slider.evaluate((el) => el.hasPointerCapture(window.__testPointerId)), true);
    await slider.evaluate((el) => {
      const foreignId = window.__testPointerId + 100;
      const x = el.getBoundingClientRect().left;
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: foreignId, clientX: x, buttons: 1 }));
      }
    });
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), before, 'foreign pointers cannot end the active drag');
    // Use the real browser capture API; the next native pointer event dispatches lostpointercapture.
    await slider.evaluate((el) => el.releasePointerCapture(window.__testPointerId));
    await page.mouse.move(right, y);
    await page.waitForFunction(() => window.__fixture.effort === 'max');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), before + 1, 'capture loss and later pointerup commit once');
    assert.ok(await page.evaluate(() => window.__testLostCapture >= 2), 'native capture loss followed the injected foreign event');
    assert.equal(await slider.getAttribute('aria-valuetext'), 'Ultra (max)', 'foreign movement did not replace the intended end position');

    // The current pointer's cancel settles too; a different pointer's cancel does not.
    await page.mouse.move(left, y);
    await page.mouse.down();
    await page.mouse.move(left + 1, y);
    await slider.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.__testPointerId + 100 }));
    });
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), before + 1);
    await slider.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: window.__testPointerId }));
    });
    await page.waitForFunction(() => window.__fixture.effort === 'off');
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), before + 2);

    await page.mouse.move(right, y);
    await page.mouse.down();
    await page.mouse.move(right - 1, y);
    await page.getByRole('button', { name: 'Select model' }).focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-ces-menu="root"]'));
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.__fixture.selections.length), before + 2, 'Escape and node removal discard the uncommitted drag');
    assert.equal(await page.evaluate(() => window.__fixture.messages), 0);
  } finally {
    await context.close();
  }
});

test('capture light and dark native menu layouts at the supported viewport and scale matrix', async () => {
  const out = path.join(ROOT, '.work', 'browser-layouts');
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
