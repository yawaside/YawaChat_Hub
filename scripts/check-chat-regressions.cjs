/* Run with: node scripts/check-chat-regressions.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
// Compile project TypeScript for these isolated tests, without adding a runtime bundler.
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: filename });
  module._compile(outputText, filename);
};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { BAN_PRESETS, DEFAULT_FILTERS, PLATFORM_IDS, applyPreset, unapplyPreset, resolvePresetRules, buildSpeechText } = require('../src/lib/core.ts');
const { sanitizeTts } = require('../src/lib/tts-config.ts');
const { DENSITY_PRESETS, DEFAULT_CHAT_VIEW } = require('../src/lib/widget.ts');
const { APP_VARIANTS } = require('../src/lib/app-variants.ts');
const { PLATFORM_PATHS } = require('../src/components/brands.tsx');
const ChatMessage = require('../src/components/app/ChatMessage.tsx').default;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }
const preset = id => BAN_PRESETS.find(p => p.id === id);
const base = () => sanitizeTts({ filters: { ...DEFAULT_FILTERS, dedupe: false } }).filters;
const say = (filters, platform, text, author = 'test_user') => buildSpeechText({ id: 'test', platform, author, text, ts: Date.UTC(2026,0,1), color: '#f00', badges: [] }, { author: false, platform: false, text: true }, filters, new Map());

check('Every platform has its own preset group', () => {
  for (const id of PLATFORM_IDS) assert.ok(BAN_PRESETS.some(p => p.platform === id), id);
  assert.equal(new Set(BAN_PRESETS.map(p => p.id)).size, BAN_PRESETS.length);
});
check('A Twitch preset does not ban messages from YouTube', () => {
  const f = applyPreset(base(), preset('twitch'));
  assert.equal(say(f, 'twitch', 'buy viewers now'), null);
  assert.ok(say(f, 'youtube', 'buy viewers now'));
});
check('Global presets affect all platforms', () => {
  const f = applyPreset(base(), preset('adult'));
  for (const platform of PLATFORM_IDS) assert.equal(say(f, platform, 'onlyfans example'), null);
});
check('Overlapping presets and custom entries survive independent deactivation', () => {
  const f = { ...base(), banWords: ['my-rule', 'порно'], maskWords: ['stupid'], banAuthors: ['my_bot'] };
  const both = applyPreset(applyPreset(f, preset('base-en')), preset('family'));
  const remaining = unapplyPreset(both, preset('family'));
  assert.ok(resolvePresetRules(remaining, 'twitch').banWords.includes('fuck'));
  assert.deepEqual(remaining.banWords, f.banWords);
  assert.deepEqual(remaining.maskWords, f.maskWords);
  assert.deepEqual(remaining.banAuthors, f.banAuthors);
});
check('Preset activation is idempotent and persists through JSON', () => {
  const f = applyPreset(applyPreset(base(), preset('youtube')), preset('youtube'));
  assert.deepEqual(f.enabledPresets, ['youtube']);
  const saved = sanitizeTts(JSON.parse(JSON.stringify({ filters: f })));
  assert.deepEqual(saved.filters.enabledPresets, ['youtube']);
  assert.equal(say(saved.filters, 'youtube', 'crypto giveaway'), null);
});
check('Legacy words are preserved rather than silently reclassified or deleted', () => {
  const f = sanitizeTts({ filters: { banWords: ['OLD-rule', 'old-rule'], maskWords: ['custom'], banAuthors: ['bot'] } }).filters;
  assert.deepEqual(f.banWords, ['old-rule']);
  assert.equal(f.legacyPresetLists, true);
  assert.deepEqual(f.enabledPresets, []);
  assert.equal(say(f, 'kick', 'old-rule example'), null);
});
check('Preset bot authors are scoped to their platform', () => {
  const f = applyPreset(base(), preset('kick'));
  assert.equal(say(f, 'kick', 'hello world', 'botrix'), null);
  assert.ok(say(f, 'youtube', 'hello world', 'botrix'));
});
check('Rendered message marks reuse the same canonical paths in all three variants', () => {
  for (const variant of APP_VARIANTS) for (const platform of PLATFORM_IDS) {
    const html = renderToStaticMarkup(React.createElement(ChatMessage, {
      variant, viewCfg: { ...DEFAULT_CHAT_VIEW, messageEffect: 'none' },
      message: { id: platform, platform, author: 'viewer', text: 'hello', ts: 0, color: '#888', badges: [] },
    }));
    assert.ok(html.includes(PLATFORM_PATHS[platform]), `${variant.id}/${platform}`);
    assert.ok(html.includes('place-items:center'));
    assert.ok(html.includes('flex:none'));
    assert.ok(html.includes('preserveAspectRatio="xMidYMid meet"'));
  }
});
check('The no-spacing preset has no residual margins, padding or message card', () => {
  const bare = { ...DEFAULT_CHAT_VIEW, ...DENSITY_PRESETS.find(p => p.id === 'bare').cfg, messageEffect: 'none' };
  for (const variant of APP_VARIANTS) {
    const html = renderToStaticMarkup(React.createElement(ChatMessage, { variant, viewCfg: bare,
      message: { id: 'bare', platform: 'twitch', author: 'viewer', text: 'hello', ts: 0, color: '#888', badges: [] },
    }));
    assert.ok(html.includes('padding:0px 0px'));
    assert.ok(html.includes('margin-bottom:0'));
    assert.ok(html.includes('data-message-layout="inline"'));
  }
});
check('Clear preset names replace metaphorical spacing names', () => {
  assert.equal(DENSITY_PRESETS.find(p => p.id === 'air').label, 'Комфортный');
  assert.ok(!DENSITY_PRESETS.some(p => /воздух/i.test(p.label + p.desc)));
});
check('Voice rules have one editor, not a duplicate copy in the voice panel', () => {
  const voice = fs.readFileSync(path.join(__dirname, '../src/components/app/VoicePanel.tsx'), 'utf8');
  for (const key of ['banWords', 'maskWords', 'banAuthors', 'allowAuthors']) assert.ok(!voice.includes(key));
  assert.equal((voice.match(/onClick=\{listen\}/g) || []).length, 1);
  const overlay = fs.readFileSync(path.join(__dirname, '../src/components/app/OverlayPanel.tsx'), 'utf8');
  assert.equal((overlay.match(/on=\{cfg.enabled\}/g) || []).length, 1);
  assert.ok(!overlay.includes('enabled: !cfg.enabled'));
});
check('OBS widget and React share the exact five brand paths', () => {
  const widget = fs.readFileSync(path.join(__dirname, '../desktop/widget/index.html'), 'utf8');
  for (const platform of PLATFORM_IDS) assert.ok(widget.includes(PLATFORM_PATHS[platform]), platform);
});
check('Settings panels do not repeat controls bound to the same field', () => {
  for (const name of ['VoicePanel', 'FiltersPanel', 'ChatViewPanel', 'WidgetPanel', 'OverlayPanel']) {
    const file = path.join(__dirname, `../src/components/app/${name}.tsx`);
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const fields = [];
    const visit = node => {
      if (ts.isJsxSelfClosingElement(node) && ['Toggle', 'Slider', 'Select', 'TagInput', 'NumberInput'].includes(node.tagName.getText(source))) {
        const attr = node.attributes.properties.find(a => ts.isJsxAttribute(a) && ['on', 'value', 'items'].includes(a.name.getText(source)));
        if (attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const value = attr.initializer.expression.getText(source);
          if (/^(cfg|f|template)\.\w+$/.test(value)) fields.push(value);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(new Set(fields).size, fields.length, `${name}: repeated ${fields.filter((v, i) => fields.indexOf(v) !== i).join(', ')}`);
  }
});
console.log(`\n${passed} regression checks passed.`);
