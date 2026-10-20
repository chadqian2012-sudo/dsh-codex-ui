import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFICIAL_CLIENT_PATH, OFFICIAL_PACKAGE_PATH, readAsarEntry, readOfficialCss } from './browser-fixture.mjs';

const client = () => readAsarEntry(OFFICIAL_CLIENT_PATH).toString('utf8');

test('installed official model selector package and menu accessibility contract are pinned', () => {
  const metadata = JSON.parse(readAsarEntry(OFFICIAL_PACKAGE_PATH).toString('utf8'));
  assert.equal(metadata.version, '0.2.1-rc.2');

  const source = client();
  assert.match(source, /"aria-haspopup":\s*"menu"/);
  assert.match(source, /"aria-expanded":\s*open/);
  assert.match(source, /"aria-controls":\s*open\s*\?\s*`\$\{id\}-menu`/);
  assert.match(source, /["']?role["']?\s*:\s*pane\s*===\s*"model"\s*\?\s*"group"\s*:\s*"menu"/);
  assert.match(source, /role:\s*"menuitem"/);
  assert.match(source, /role:\s*"menuitemradio"/);
  assert.match(source, /"data-provider-id":\s*provider\.id/);
  assert.match(source, /"data-model-id":\s*model\.id/);
  assert.match(source, /id:\s*`\$\{id\}-models`/);
  assert.match(source, /className:\s*clsx\(ModelSelect_module_css_default\.groups,\s*"scrollable"\)/);
  assert.match(source, /className:\s*clsx\(ModelSelect_module_css_default\.option,\s*ModelSelect_module_css_default\.modelOption/);
  assert.match(source, /choose\(\{\s*provider:\s*group\.id,\s*model:\s*model\.id/);
  assert.match(source, /"aria-label":\s*t\("menu\.aria"\)/);

  const rootRows = source.match(/role:\s*"menuitem"/g) ?? [];
  assert.equal(rootRows.length, 2, 'root pane has exactly the model and effort menuitem rows');
  const css = readOfficialCss();
  assert.match(css, /\.wq12jW_menu\{/);
  assert.match(css, /\.wq12jW_groups\{/);
});

test('native selection serializes UI availability and rejects stale directory responses', () => {
  const source = client();
  assert.match(source, /s\.status\s*=\s*"selecting";\s*s\.pending\s*=\s*selection/);
  assert.match(source, /this\.disposed\s*\|\|\s*generation\s*!==\s*this\.generation/);
  assert.match(source, /const busy\s*=\s*pending\s*!==\s*null/);
  assert.match(source, /disabled:\s*busy/);
});

test('DeepSeek advertises the four real effort IDs and delegates model defaults', () => {
  const source = readAsarEntry('dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js').toString('utf8');
  for (const [name, value] of [['OFF','off'],['LOW','low'],['HIGH','high'],['MAX','max']]) {
    assert.ok(source.includes(`const ${name}_REASONING_EFFORT = ReasoningEffortId("${value}")`));
  }
  assert.match(source, /const REASONING_EFFORTS\s*=\s*\[\s*\{\s*id:\s*OFF_REASONING_EFFORT[\s\S]*?id:\s*LOW_REASONING_EFFORT[\s\S]*?id:\s*HIGH_REASONING_EFFORT[\s\S]*?id:\s*MAX_REASONING_EFFORT/);
  assert.match(source, /defaultEffort:\s*connection\.defaults\.reasoningEffort/);
});
