const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
fs.mkdirSync('artifacts/qa', { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('yawa:variant', JSON.stringify('command'));
    localStorage.setItem('yawa:tts', JSON.stringify({ enabled: true }));
  });
  await page.goto('http://127.0.0.1:3000/#/app', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-chat-message]', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // Версия приложения обязана совпадать с релизом (раздел «О программе»).
  const version = fs.readFileSync('VERSION', 'utf8').trim();
  await page.locator('[title="Настройки"]').first().click();
  await page.waitForTimeout(400);
  const settings = page.getByRole('dialog', { name: 'Настройки' });
  await settings.getByRole('navigation').getByTitle('О программе').click();
  await page.waitForTimeout(300);
  const about = await settings.innerText();
  assert.ok(about.includes(version), `в «О программе» нет версии ${version}: ${about.replace(/\s+/g,' ').slice(0, 200)}`);
  console.log(`✓ приложение показывает версию ${version}`);
  await settings.getByTitle('Закрыть настройки').click();
  await page.waitForTimeout(300);

  // Кнопка «не озвучивать» у сообщения.
  const row = page.locator('[data-chat-message]').first();
  const author = await row.locator('strong').first().innerText();
  const mute = row.locator('[data-mute-author]');
  await expect(mute).toHaveCount(1);
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  // Геометрия строки не меняется при появлении кнопки — лента не дёргается.
  const before = await row.boundingBox();
  await row.hover();
  await page.waitForTimeout(200);
  const after = await row.boundingBox();
  assert.ok(Math.abs(before.height - after.height) < 0.5 && Math.abs(before.width - after.width) < 0.5,
    `строка меняет размер при наведении: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  console.log('✓ кнопка не сдвигает строку ленты');

  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('yawa:tts')));
  assert.ok(saved.filters.banAuthors.includes(author.toLowerCase()),
    `автор ${author} не попал в список игнора: ${JSON.stringify(saved.filters.banAuthors)}`);
  console.log(`✓ «${author}» добавлен в список «не озвучивать» и сохранён`);

  // Тот же список виден в настройках.
  await page.locator('[title="Настройки"]').first().click();
  await page.waitForTimeout(400);
  const dialog = page.getByRole('dialog', { name: 'Настройки' });
  await dialog.getByRole('navigation').getByTitle('Фильтры озвучки').click();
  await dialog.locator('[data-settings-page="filters"]').getByRole('tab', { name: 'Авторы' }).click();
  await expect(dialog.getByText(author.toLowerCase(), { exact: true }).first()).toBeVisible();
  console.log('✓ тот же автор виден в «Фильтры → Авторы»');
  await page.screenshot({ path: 'artifacts/qa/mute-author.png' });

  // Снятие отключения возвращает озвучку.
  await dialog.getByTitle('Закрыть настройки').click();
  await page.waitForTimeout(300);
  const muted = page.locator(`[data-mute-author="${author}"]`).first();
  await muted.click();
  const after2 = await page.evaluate(() => JSON.parse(localStorage.getItem('yawa:tts')));
  assert.ok(!after2.filters.banAuthors.includes(author.toLowerCase()), 'повторное нажатие возвращает озвучку');
  console.log('✓ повторное нажатие снова включает озвучку автора');

  assert.deepEqual(errors, [], `ошибки в браузере: ${errors.join(' | ')}`);
  console.log('\nПроверка пройдена.');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
