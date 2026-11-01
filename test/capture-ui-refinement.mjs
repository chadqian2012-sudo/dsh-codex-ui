import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startBrowserFixture, resolveDependency } from './browser-fixture.mjs';
const out = path.resolve(process.argv[2] ?? 'preview/screenshots/rc3');
await fs.mkdir(out,{recursive:true});
const require = createRequire(import.meta.url);
const { chromium } = require(resolveDependency('playwright','index.js'));
const fixture=await startBrowserFixture();
const browser=await chromium.launch({executablePath:fixture.executablePath,headless:true});
try {
for(const theme of ['light','dark']) {
 const page=await browser.newPage({viewport:{width:900,height:700},deviceScaleFactor:2});
 await page.goto(fixture.url);
 await page.waitForFunction(()=>window.__registration&&window.__applyPlugin);
 await page.evaluate(dark=>{ document.body.dataset.theme=dark?'dark':'light';document.body.toggleAttribute('data-ds-dark-theme',dark);window.__applyPlugin();},theme==='dark');
 await page.waitForSelector('[data-ces-part="anchor"]',{state:'attached'});
 await page.getByRole('button',{name:'Select model'}).click();
 await page.waitForSelector('[data-ces-menu="root"]');
 for(const [label,key] of [['high','Home'],['ultra','End']]) {
  const slider=page.locator('[data-ces-part="track"]');await slider.focus();await page.keyboard.press(key);
  if(label==='high')for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');
  await page.waitForFunction(name=>document.querySelector('[data-ces-part="track"]')?.getAttribute('aria-valuetext')===name,label==='high'?'High (high)':'Ultra (max)');
  await page.waitForTimeout(500);await slider.evaluate(el=>el.blur());
  await page.locator('[data-ces-menu="root"]').screenshot({path:path.join(out,`${theme}-${label}.png`)});
 }
 await page.locator('[data-ces-row="model"]').click();await page.waitForSelector('[data-ces-menu="models"]');
 await page.getByRole('menuitemradio').first().hover();
 await page.locator('[data-ces-menu="models"]').screenshot({path:path.join(out,`${theme}-models.png`)});
 await page.close();
}
const gallery=await browser.newPage({viewport:{width:760,height:900},deviceScaleFactor:1.5});
const cards=[];
for(const label of ['high','ultra','models']) for(const theme of ['light','dark']) {
 const png=await fs.readFile(path.join(out,`${theme}-${label}.png`));
 cards.push(`<section class="${theme}"><p>${theme==='light'?'浅色':'深色'} · ${label==='models'?'模型列表':label.toUpperCase()}</p><img src="data:image/png;base64,${png.toString('base64')}" /></section>`);
}
await gallery.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#eceef2;color:#303034;font:14px system-ui,'Microsoft YaHei',sans-serif}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{font-size:12px;color:#85858b;margin:0 0 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}section{padding:12px;border-radius:18px;background:#fff}.dark{background:#242529}img{display:block;width:100%;height:auto}</style><h1>DSH Codex UI · rc3 开发预览</h1><p>Unreleased · 隔离 React fixture + DSH 0.2.1-rc.3 原生菜单 CSS · 不是真实会话截图</p><div class="grid">${cards.join('')}</div>`);
await gallery.evaluate(()=>Promise.all([...document.images].map(img=>img.decode())));
await gallery.setViewportSize({width:760,height:await gallery.evaluate(()=>Math.ceil(document.body.getBoundingClientRect().height))});
await gallery.screenshot({path:path.join(out,'overview.png'),fullPage:true});await gallery.close();
console.log('Captured '+out);
}finally{await browser.close();await new Promise(r=>fixture.server.close(r));}
