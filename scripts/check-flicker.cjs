/* Start the preview first, then: node scripts/check-flicker.cjs */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseURL = process.env.PREVIEW_TEST_URL || 'http://127.0.0.1:3000';
const out = path.join(process.cwd(), 'artifacts/qa');
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.addInitScript(() => {
    localStorage.setItem('yawa:variant', JSON.stringify('command'));
    localStorage.setItem('yawa:tts', JSON.stringify({ enabled: true }));
    localStorage.setItem('yawa:menuCollapsed', 'false');
    localStorage.setItem('yawa:channelsCollapsed', 'false');
  });

  await page.goto(`${baseURL}/#/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  /* ── 1. Селекторы мигающих частей ── */
  const headerToggle = page.locator('header button[title*="Озвучка"]').first();
  await expect(headerToggle).toBeVisible();
  const speechRail = page.locator('aside button[title*="Озвучка"]').first();
  const feed = page.locator('[data-chat-feed]');

  /* ── 2. Снимаем геометрию мигающих элементов N раз подряд ── */
  const sample = async (locator, label) => {
    const box = await locator.boundingBox();
    assert.ok(box, `${label}: element not found`);
    return { x: +box.x.toFixed(1), y: +box.y.toFixed(1), w: +box.width.toFixed(1), h: +box.height.toFixed(1) };
  };

  const samples = { header: [], rail: [], headerIcon: [] };
  const headerIcon = headerToggle.locator('span').first();
  for (let i = 0; i < 18; i++) {
    samples.header.push(await sample(headerToggle, 'header toggle'));
    samples.headerIcon.push(await sample(headerIcon, 'header icon'));
    if (await speechRail.count()) samples.rail.push(await sample(speechRail, 'rail button'));
    await page.waitForTimeout(400);
  }

  /* Пока озвучка включена и чат активно шлёт сообщения, геометрия элементов
     обязана оставаться постоянной. Любое изменение = мигание интерфейса. */
  for (const [name, list] of Object.entries(samples)) {
    if (list.length < 4) continue;
    const first = list[0];
    const moved = list.filter(s => s.x !== first.x || s.y !== first.y || s.w !== first.w || s.h !== first.h);
    assert.equal(moved.length, 0,
      `${name}: геометрия меняется ${moved.length} раз из ${list.length} — интерфейс мигает.\n` +
      `первый: ${JSON.stringify(first)}\nпримеры: ${JSON.stringify(moved.slice(0, 3))}`);
    console.log(`✓ ${name}: геометрия стабильна (${list.length} замеров, 0 сдвигов)`);
  }

  /* ── 3. Иконка озвучки не подменяется другой ── */
  const iconCount = await headerToggle.locator('span[aria-hidden="true"]').count();
  assert.equal(iconCount, 1, `в тумблере озвучки ${iconCount} индикаторов вместо одного`);
  const bars = await headerToggle.locator('span[aria-hidden="true"] > span').count();
  assert.equal(bars, 4, `у индикатора ${bars} полос вместо 4`);
  console.log('✓ индикатор озвучки один и всегда смонтирован (4 полосы, без подмены)');

  /* ── 4. Частота перерисовок ленты ──
     Считаем мутации DOM в статичной области (панель инструментов).
     Раньше всё окно перерисовывалось каждую секунду из-за служебного таймера. */
  const mutationRate = await page.evaluate(async () => {
    const target = document.querySelector('aside') || document.querySelector('header');
    if (!target) return -1;
    let mutations = 0;
    const observer = new MutationObserver(list => { mutations += list.length; });
    observer.observe(target, { attributes: true, childList: true, subtree: true, characterData: true });
    const before = target.getBoundingClientRect();
    await new Promise(r => setTimeout(r, 5000));
    const after = target.getBoundingClientRect();
    observer.disconnect();
    // Геометрия обязана не измениться: это и есть признак «мигания».
    const stable = Math.abs(before.width - after.width) < 0.5 && Math.abs(before.height - after.height) < 0.5;
    return { mutations, stable };
  });
  assert.ok(mutationRate.stable, 'панель каналов меняет размер во время работы — интерфейс мигает');
  console.log(`✓ панель каналов не меняет размеры во время потока сообщений (${mutationRate.mutations} мутаций за 5 с)`);

  /* ── 5. Индикатор в состоянии «выключено» не анимируется ── */
  await headerToggle.click();
  await page.waitForTimeout(400);
  const idleAnimation = await headerToggle.locator('span[aria-hidden="true"] > span').first()
    .evaluate(el => getComputedStyle(el).animationName);
  assert.equal(idleAnimation, 'none', `в выключенном состоянии полосы анимируются (${idleAnimation})`);
  console.log('✓ при выключенной озвучке индикатор полностью статичен');

  /* В headless-браузере нет голосов, поэтому фраза «заканчивается» мгновенно и
     окно анимации короче одного кадра — наблюдать её здесь нельзя. Вместо этого
     проверяем главное: индикатор НЕ пересоздаётся при переключении состояния.
     Именно пересоздание (Eq -> Volume2 -> точка) вызывало мигание интерфейса. */
  const probe = await headerToggle.locator('span[aria-hidden="true"]').first()
    .evaluate(el => { el.setAttribute('data-flicker-probe', '1'); return true; });
  assert.ok(probe, 'не удалось пометить индикатор');
  await headerToggle.click();
  await page.waitForTimeout(500);
  const stillSame = await page.locator('[data-flicker-probe]').count();
  assert.equal(stillSame, 1, 'индикатор пересоздан при переключении озвучки — источник мигания');
  console.log('✓ индикатор не пересоздаётся при переключении состояния (тот же DOM-узел)');

  // Оставляем озвучку включённой для последующих проверок.
  await headerToggle.click();
  await page.waitForTimeout(400);

  /* ── 6. Лента продолжает работать и скроллиться ── */
  const rows = await feed.locator('[data-chat-message]').count();
  assert.ok(rows > 0, 'лента пуста');
  await page.screenshot({ path: path.join(out, 'flicker-check.png') });
  console.log(`✓ лента работает, сообщений: ${rows}`);

  assert.deepEqual(errors, [], `ошибки в браузере: ${errors.join(' | ')}`);
  console.log('\nПроверка мигания пройдена.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
