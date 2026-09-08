/* Start the preview first, then: node scripts/check-chat-browser.cjs */
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseURL = process.env.PREVIEW_TEST_URL || 'http://127.0.0.1:3000';
const artifacts = path.join(process.cwd(), 'artifacts/qa');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /hydration|Minified React error/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    if (!localStorage.getItem('qa-initialized')) {
      localStorage.setItem('yawa:variant', JSON.stringify('terminal'));
      localStorage.setItem('yawa:menuCollapsed', 'false');
      localStorage.setItem('yawa:channelsCollapsed', 'false');
      localStorage.setItem('yawa:tts', JSON.stringify({ enabled: false }));
      localStorage.setItem('qa-initialized', 'true');
    }
  });
  const dialog = page.getByRole('dialog', { name: 'Настройки', exact: true });
  const navigate = async title => {
    await dialog.getByRole('navigation', { name: 'Разделы настроек' }).getByTitle(title, { exact: true }).click();
  };
  const closeSettings = async () => { await dialog.getByTitle('Закрыть настройки', { exact: true }).click(); await expect(dialog).toHaveCount(0); };
  const openSettings = async () => {
    await page.getByTitle('Настройки', { exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
  };
  const checkCenters = async locator => {
    const measurements = await locator.evaluateAll(badges => badges.map(b => {
      const icon = b.querySelector('svg');
      const tile = b.getBoundingClientRect(), rect = icon.getBoundingClientRect();
      return { platform: b.dataset.platformBadge, square: Math.abs(rect.width - rect.height),
        x: Math.abs((rect.x + rect.width / 2) - (tile.x + tile.width / 2)),
        y: Math.abs((rect.y + rect.height / 2) - (tile.y + tile.height / 2)),
        width: rect.width, height: rect.height, path: icon.querySelector('path').getAttribute('d') };
    }));
    assert.ok(measurements.length, 'There must be actual SVG badges to measure');
    for (const m of measurements) {
      assert.ok(m.width >= 10 && m.square < .1, `Square SVG: ${JSON.stringify(m)}`);
      assert.ok(m.x <= .6 && m.y <= .6, `Centered SVG: ${JSON.stringify(m)}`);
    }
    return measurements;
  };
  try {
    await page.goto(`${baseURL}/#/app`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-terminal-channel]')).toHaveCount(5);
    await page.waitForTimeout(600);
    for (const width of [1440, 1280, 1024, 850, 768, 640]) {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForTimeout(100);
      const layout = await page.locator('[data-terminal-grid]').evaluate(el => ({
        available: el.clientWidth, actual: el.scrollWidth,
        boxes: [...el.querySelectorAll('[data-terminal-channel]')].map(c => ({ top: c.getBoundingClientRect().top, width: c.getBoundingClientRect().width, height: c.getBoundingClientRect().height })),
      }));
      assert.equal(layout.boxes.length, 5);
      assert.ok(layout.actual <= layout.available + 1, `No horizontal scroll at ${width}: ${JSON.stringify(layout)}`);
      assert.ok(layout.boxes.every(b => Math.abs(b.top - layout.boxes[0].top) < 1), `Five channels in a row at ${width}`);
      assert.ok(layout.boxes.every(b => b.height <= 49), 'Compact height');
      assert.ok(layout.boxes.every(b => b.width <= 176), 'Compact width also on wide windows');
      console.log(`✓ Terminal: five channels in one row, no horizontal scroll at ${width}px`);
    }
    await page.setViewportSize({ width: 1024, height: 850 });
    await page.screenshot({ path: path.join(artifacts, 'terminal.png') });
    await page.setViewportSize({ width: 1280, height: 850 });
    for (const [id, name] of [['command', 'Команда'], ['terminal', 'Терминал'], ['studio', 'Студия']]) {
      await page.getByTitle(new RegExp(`^${name} —`)).click();
      await openSettings();
      await navigate('Вид ленты');
      const view = dialog.locator('[data-settings-page="chatview"]');
      await view.getByRole('combobox', { name: 'Режим отображения сообщений' }).selectOption('normal');
      await expect(view.locator('[data-chat-preview] [data-chat-message]')).toHaveCount(5);
      await page.waitForTimeout(500);
      await checkCenters(view.locator('[data-chat-preview] [data-platform-badge]'));
      await view.getByRole('combobox', { name: 'Режим отображения сообщений' }).selectOption('bare');
      await page.waitForTimeout(300);
      await expect(view.locator('[data-message-layout="inline"]')).toHaveCount(5);
      const spaces = await view.locator('[data-chat-message]').evaluateAll(nodes => nodes.map(n => {
        const c = getComputedStyle(n); return [c.paddingLeft, c.paddingRight, c.paddingTop, c.paddingBottom, c.marginBottom];
      }));
      assert.ok(spaces.flat().every(v => v === '0px'));
      await checkCenters(view.locator('[data-chat-preview] [data-platform-badge]'));
      if (id === 'studio') await page.screenshot({ path: path.join(artifacts, 'feed-settings.png') });
      await closeSettings();
      await page.waitForTimeout(1500);
      const feed = page.locator('[data-chat-feed]');
      if (await feed.locator('[data-platform-badge]').count()) await checkCenters(feed.locator('[data-platform-badge]'));
      console.log(`✓ ${name}: five centered brand marks in shared preview; zero-spacing mode also correct`);
    }
    await page.getByTitle(/^Команда —/).click();
    await openSettings();
    await navigate('Озвучка');
    const voice = dialog.locator('[data-settings-page="voice"]');
    await expect(voice.getByRole('button', { name: 'Прослушать пример', exact: true })).toHaveCount(1);
    await expect(voice.locator('textarea')).toHaveCount(0);
    await expect(voice.getByRole('switch', { name: 'Озвучивать сообщения', exact: true })).toHaveCount(1);
    await page.screenshot({ path: path.join(artifacts, 'voice-settings.png') });
    await navigate('Оверлей');
    const overlay = dialog.locator('[data-settings-page="overlay"]');
    await expect(overlay.getByRole('switch', { name: 'Показывать оверлей', exact: true })).toHaveCount(1);
    await overlay.getByRole('switch', { name: 'Показывать оверлей', exact: true }).click();
    await expect(overlay.getByRole('switch', { name: 'Показывать оверлей', exact: true })).toHaveAttribute('aria-checked', 'true');
    await overlay.getByRole('switch', { name: 'Показывать оверлей', exact: true }).click();
    console.log('✓ Voice and overlay settings have single, working controls');

    await navigate('Фильтры озвучки');
    const filters = dialog.locator('[data-settings-page="filters"]');
    await expect(filters.locator('[data-preset-id]')).toHaveCount(3);
    const twitchSwitch = filters.locator('[data-preset-id="twitch"]').getByRole('switch');
    await twitchSwitch.click();
    await expect(twitchSwitch).toHaveAttribute('aria-checked', 'true');
    await filters.getByRole('tab', { name: 'Свои слова', exact: true }).click();
    await filters.getByRole('textbox', { name: 'Добавить слова через запятую', exact: true }).fill('my_rule, MY_RULE');
    await filters.getByRole('button', { name: 'Добавить', exact: true }).first().click();
    await expect(filters.getByText('my_rule', { exact: true })).toHaveCount(1);
    await filters.getByRole('tab', { name: 'Проверка', exact: true }).click();
    await filters.getByRole('textbox', { name: 'Сообщение', exact: true }).fill('buy viewers now');
    await filters.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(filters.getByRole('status')).toContainText('Не будет озвучено');
    await filters.getByRole('combobox', { name: 'Площадка проверки' }).selectOption('youtube');
    await filters.getByRole('button', { name: 'Проверить', exact: true }).click();
    await expect(filters.getByRole('status')).toContainText('Будет озвучено');
    await filters.getByRole('tab', { name: /^Пресеты/ }).click();
    await filters.getByRole('button', { name: 'Kick', exact: true }).click();
    await expect(filters.locator('[data-preset-id]')).toHaveCount(1);
    await filters.locator('[data-preset-id="kick"]').getByRole('switch').click();
    await filters.getByRole('button', { name: /^Twitch/ }).click();
    await expect(twitchSwitch).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: path.join(artifacts, 'platform-presets.png') });
    await twitchSwitch.click();
    assert.ok((await page.evaluate(() => JSON.parse(localStorage.getItem('yawa:tts')))).filters.banWords.includes('my_rule'));
    await twitchSwitch.click();
    console.log('✓ Presets: platform groups, activation, scoped test, personal entries preserved');

    await closeSettings();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings();
    await navigate('Фильтры озвучки');
    await expect(dialog.locator('[data-preset-id="twitch"]').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await dialog.getByTitle('Свернуть меню', { exact: true }).click();
    await expect(dialog.locator('.settings-navigation')).toHaveAttribute('data-collapsed', 'true');
    await expect(dialog.locator('.settings-navigation')).toHaveCSS('width', '54px');
    const sidebar = await dialog.locator('.settings-navigation').boundingBox();
    assert.ok(sidebar.width <= 56);
    await dialog.getByTitle('Развернуть меню', { exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Поиск по настройкам' }).fill('отступ');
    await dialog.getByRole('textbox', { name: 'Поиск по настройкам' }).press('Enter');
    await expect(dialog.locator('[data-settings-page="chatview"]')).toBeVisible();
    console.log('✓ Reload persistence, actual sidebar collapse and settings search');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'No page overflow on narrow viewport');
    await page.screenshot({ path: path.join(artifacts, 'mobile-settings.png') });
    assert.deepEqual(errors, [], `No browser/hydration errors: ${errors.join('\n')}`);
    console.log(`\nBrowser checks passed; screenshots saved in ${artifacts}`);
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Browser errors:', errors);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
