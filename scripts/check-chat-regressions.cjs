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
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
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
check('Speech visualization Eq does not animate infinitely when idle or disabled', () => {
  const { Eq } = require('../src/components/bits.tsx');
  const staticEq = renderToStaticMarkup(React.createElement(Eq, { active: false }));
  assert.ok(staticEq.includes('animation:none'), 'When active=false, animation must be none');
  assert.ok(!staticEq.includes('animate-eq'), 'When active=false, no animate-eq class');
  const activeEq = renderToStaticMarkup(React.createElement(Eq, { active: true }));
  assert.ok(activeEq.includes('animation:eq'), 'When active=true, animation is enabled');
});
check('Speech indicator keeps identical geometry whether idle or speaking', () => {
  const { Eq } = require('../src/components/bits.tsx');
  const idle = renderToStaticMarkup(React.createElement(Eq, { active: false, size: 13 }));
  const speaking = renderToStaticMarkup(React.createElement(Eq, { active: true, size: 13 }));
  const geometry = html => {
    const width = /width:([\d.]+)px/.exec(html)?.[1];
    const height = /height:(\d+)px/.exec(html)?.[1];
    const min = /minWidth:([\d.]+)px/.exec(html)?.[1];
    return { width, height, min };
  };
  // Одинаковая рамка в обоих состояниях — элемент не может сдвинуть соседей.
  assert.deepEqual(geometry(speaking), geometry(idle));
  assert.ok(speaking.includes('animation:eq'), 'speaking state animates');
  assert.ok(idle.includes('animation:none'), 'idle state is static');
  // Пока не идёт речь — анимации нет ни в одном состоянии, кроме активного.
  assert.ok(idle.includes('animation:none') && !idle.includes('animation:eq 0.9s'));
});

check('Speech controls never swap the indicator for another icon mid-speech', () => {
  // Раньше иконка менялась Volume2 -> Eq -> точка при каждом входе/выходе фразы,
  // из-за чего часть интерфейса мигала. Теперь внутри условий Eq не подменяется.
  for (const [name, dir] of [['SpeechPanel.tsx', 'app'], ['ChatPanel.tsx', 'app'], ['DesktopApp.tsx', '.']]) {
    const text = fs.readFileSync(path.join(__dirname, '../src/components', dir, name), 'utf8');
    // Volume2 не должен встречаться в том же тернарнике, что и <Eq.
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('<Eq')) {
        const window = lines.slice(i, i + 6).join('\n');
        assert.ok(!window.includes('<Volume2'), `${name}: <Eq> is swapped for <Volume2> near line ${i + 1}`);
      }
    }
  }
});

check('Chat simulation does not trigger a re-render every second', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '../src/lib/bridge.ts'), 'utf8');
  assert.ok(bridge.includes('prev.status !== c.status'), 'compares visible channel status');
  assert.ok(bridge.includes('prev.viewers !== c.viewers'), 'compares viewer count');
  assert.ok(!/if \(changed\) setChannels\(next\);/.test(bridge), 'no longer updates on every tick');
});

check('Calm indicator animations replace the aggressive pulse', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');
  assert.ok(css.includes('@keyframes soft-pulse'), 'soft pulse keyframes exist');
  assert.ok(css.includes('.animate-caret'), 'terminal caret animation exists');
  for (const [name, dir] of [['ChatPanel.tsx', 'app'], ['DesktopApp.tsx', '.']]) {
    const text = fs.readFileSync(path.join(__dirname, '../src/components', dir, name), 'utf8');
    assert.ok(!text.includes('animate-pulse'), `${name} still uses aggressive animate-pulse`);
  }
});

check('Feed rows are memoized so they do not repaint on every update', () => {
  const msg = fs.readFileSync(path.join(__dirname, '../src/components/app/ChatMessage.tsx'), 'utf8');
  assert.ok(msg.includes('export default memo(ChatMessage)'));
});

/* ─────────── звук в OBS ─────────── */

check('OBS audio travels on its own channel and no longer clobbers the widget look', () => {
  const server = read('desktop/electron/widgetServer.js');
  const main = read('desktop/electron/main.js');
  const widget = read('desktop/widget/index.html');

  assert.ok(server.includes('sendTts('), 'сервер отправляет озвучку отдельным каналом');
  assert.ok(server.includes('type: "tts"'), 'у озвучки свой тип сообщения');
  // Раньше служебный payload сохранялся как «последнее оформление» и приходил
  // новым клиентам OBS вместо стилей.
  assert.ok(!server.includes('if (!payload.ttsPlay && !payload.ttsAudio) state.config = payload;'));
  assert.ok(main.includes('widgetServer.sendTts('), 'main шлёт аудио через sendTts');
  assert.ok(widget.includes('data.type === "tts"'), 'виджет понимает отдельный канал');
  // Настройки озвучки больше не отправляются виджету как оформление.
  assert.ok(!read('src/components/DesktopApp.tsx').includes('widgetConfig?.({ tts: ttsSafe })'));
});

check('OBS widget keeps one player, queues phrases and reports blocked autoplay', () => {
  const widget = read('desktop/widget/index.html');
  // Один переиспользуемый проигрыватель: раньше new Audio(...) не сохранялся
  // и сборщик мусора мог оборвать воспроизведение.
  assert.ok(widget.includes('const ttsAudio = new Audio()'), 'проигрыватель создаётся один раз');
  assert.ok(!widget.includes('const audio = new Audio(`data:'), 'нет одноразового Audio с data-URL');
  assert.ok(widget.includes('URL.createObjectURL'), 'аудио отдаётся как Blob, а не огромный data-URL');
  assert.ok(widget.includes('URL.revokeObjectURL'), 'ссылки на Blob освобождаются');
  assert.ok(widget.includes('ttsQueue'), 'фразы становятся в очередь и не накладываются');
  // Автовоспроизведение может быть заблокировано — раньше ошибка молча гасилась.
  assert.ok(!widget.includes('audio.play().catch(() => {});'), 'ошибка воспроизведения не проглатывается');
  assert.ok(widget.includes('NotAllowedError'), 'блокировка автовоспроизведения распознаётся');
  assert.ok(widget.includes('"tts-status"'), 'виджет сообщает статус приложению');
});

check('The app explains why OBS stays silent instead of showing nothing', () => {
  assert.ok(read('desktop/electron/preload.js').includes('onObsTts'), 'мост отдаёт статус озвучки');
  const main = read('desktop/electron/main.js');
  assert.ok(main.includes('onStatus'), 'сервер принимает статус от виджета');
  assert.ok(main.includes('"no-client"'), 'отсутствие подключённого OBS отслеживается');
  const desktopApp = read('src/components/DesktopApp.tsx');
  for (const state of ['blocked', 'no-voice', 'no-client']) {
    assert.ok(desktopApp.includes(state), `подсказка для состояния ${state}`);
  }
});

/* ─────────── отключение озвучки автора из ленты ─────────── */

check('A viewer can be muted straight from the feed', () => {
  const message = read('src/components/app/ChatMessage.tsx');
  const panel = read('src/components/app/ChatPanel.tsx');
  const desktopApp = read('src/components/DesktopApp.tsx');
  assert.ok(message.includes('data-mute-author'), 'у сообщения есть кнопка отключения автора');
  assert.ok(message.includes('aria-pressed'), 'состояние кнопки доступно скринридеру');
  assert.ok(panel.includes('onToggleMuteAuthor'), 'лента пробрасывает обработчик');
  assert.ok(panel.includes('mutedSet'), 'проверка автора идёт через Set, а не перебор массива');
  // Список общий с разделом «Фильтры → Авторы»: одно место хранения.
  assert.ok(desktopApp.includes('banAuthors'), 'мьют пишется в общий список игнора');
  assert.ok(desktopApp.includes('toggleMuteAuthor'), 'обработчик подключён');
});

check('Muting an author actually stops speech for that author', () => {
  const filters = { ...DEFAULT_FILTERS, dedupe: false, banAuthors: ['spam_bot'] };
  const say = (author) => buildSpeechText(
    { id: 'm', platform: 'twitch', author, text: 'привет', ts: Date.now(), color: '#fff', badges: [] },
    { author: false, platform: false, text: true }, filters, new Map()
  );
  assert.equal(say('spam_bot'), null, 'заглушённый автор не озвучивается');
  assert.equal(say('SPAM_BOT'), null, 'регистр ника не важен');
  assert.ok(say('normal_viewer'), 'остальные зрители озвучиваются как обычно');
});

/* ─────────── нагрузка на процессор и память ─────────── */

check('No component wakes the app every second while idle', () => {
  const overlay = read('src/components/OverlayApp.tsx');
  const panel = read('src/components/app/ChatPanel.tsx');
  // Оверлей лежит поверх игры: лишний таймер там дороже всего.
  assert.ok(!overlay.includes('setInterval(() => setTick'), 'оверлей не крутит секундный таймер');
  assert.ok(overlay.includes('nextExpiry'), 'таймер ставится ровно на момент истечения TTL');
  assert.ok(!panel.includes('setInterval(() => setNow(new Date()), 1000)'), 'часы не будят рендерер ежесекундно');
  assert.ok(panel.includes('visibilitychange'), 'скрытое окно не обновляет часы');
});

check('Hidden overlay does not receive the chat stream', () => {
  const main = read('desktop/electron/main.js');
  assert.ok(main.includes('FEED_CHANNELS'), 'поток чата отделён от служебных событий');
  assert.ok(main.includes('!overlayWin.isVisible()'), 'скрытый оверлей пропускается');
  assert.ok(main.includes('backgroundThrottling: true'), 'свёрнутое окно замораживает таймеры');
  assert.ok(main.includes('max-old-space-size'), 'куча V8 ограничена');
});

/* ─────────── совместимость с другим ПО ─────────── */

check('TLS validation is no longer disabled for the whole process', () => {
  const main = read('desktop/electron/main.js');
  const net = read('desktop/electron/net.js');
  // Раньше одна строка отключала проверку сертификатов во всём приложении.
  // Ищем именно присваивание, а не упоминание в поясняющем комментарии.
  const activeAssignment = (src) => src.split('\n').some((line) => {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*')) return false;
    return /process\.env\.NODE_TLS_REJECT_UNAUTHORIZED\s*=/.test(code);
  });
  assert.ok(!activeAssignment(main), 'глобальное отключение TLS убрано из main.js');
  assert.ok(!activeAssignment(net), 'глобальное отключение TLS убрано из net.js');
  assert.ok(net.includes('isTrustedHost'), 'поблажка ограничена списком чат-хостов');
  assert.ok(net.includes('installCertificateHandler'), 'ошибки сертификатов разбираются точечно');
  assert.ok(main.includes('installCertificateHandler(app)'), 'обработчик подключён');
});

check('The app coexists with other overlays and a second launch', () => {
  const main = read('desktop/electron/main.js');
  // "screen-saver" перекрывает панели других программ — теперь это выбор пользователя.
  assert.ok(main.includes('aggressiveTop'), 'агрессивный режим поверх окон отключаемый');
  assert.ok(main.includes('applyAlwaysOnTop'), 'уровень окна задаётся в одном месте');
  assert.ok(main.includes('second-instance'), 'второй запуск открывает уже работающее окно');
  assert.ok(main.includes('hotkeyConflicts'), 'конфликты горячих клавиш отслеживаются');
  assert.ok(read('src/components/app/HotkeysPanel.tsx').includes('conflicts'), 'занятая клавиша видна в настройках');
});

console.log(`\n${passed} regression checks passed.`);
