# Сборка Windows-приложений

Из одного репозитория получаются две сборки Windows x64:

* **portable** — `YawaChatHub.exe`, один файл, установка не нужна;
* **nsis** — `YawaChatHub-Setup.exe`, обычный установщик с ярлыками.

Файл `VERSION` содержит версию **следующего** релиза; линия начинается с **1.0.0**.
Каждый сегмент `minor` и `patch` — одна цифра 0…9, поэтому счёт идёт
1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0. При каждом авторелизе
workflow берёт номер из `VERSION`, синхронизирует его с интерфейсом и exe,
а затем записывает в `VERSION` следующее значение (`scripts/bump-version.mjs`).

## Локальная сборка

```bash
# 1. интерфейс (рендерер)
npm install
npm run build
xcopy dist desktop\renderer-dist /E /I /Y      # Git Bash: cp -r dist/. desktop/renderer-dist/
node scripts/sync-version.mjs "$(cat VERSION)"

# 2. оболочка
cd desktop
npm install

# Проверка перед сборкой (обязательно при ручных правках electron/*.js)
node scripts/verify-before-build.cjs

npm run dist         # только portable exe
npm run dist:setup   # только установщик
npm run dist:all     # обе сборки
```

Готовые файлы: `desktop/release/`.

## Что именно собирается

* `electron-builder` с `"npmRebuild": false` — иначе `@electron/rebuild` пытается собрать
  опциональный `bufferutil` для `ws` через node-gyp и падает без Visual Studio.
  `ws` и `tiktok-live-connector` работают на чистом JS.
* В сборку попадают `electron/**`, `renderer-dist/**`, `widget/**`.
* Иконки: `desktop/build/icon.ico` (многослойный: 16/24/32/48/64/128/256 — именно
  его electron-builder вшивает в exe, ярлык и установщик) и `desktop/build/icon.png`
  (256×256, запасной вариант). Для трея используются PNG 16/24/32 из
  `desktop/electron/assets/` — этот каталог входит в asar. Все файлы создаёт
  кроссплатформенный `scripts/prepare-icon.mjs` на чистом Node. Запускать
  вручную необязательно — CI делает это перед electron-builder.

## Автосборка в GitHub Actions

Файл `.github/workflows/release.yml`, запускается на push в `main`, на тег `v*` и вручную.

1. **build** (windows-latest): Vite → интерфейс, `npm install` в `desktop`,
   `electron-builder --win` → артефакт `YawaChatHub-<версия>` с двумя exe.
2. **tag**: создаёт `v1.0.0`, а при следующих push берёт номер из `VERSION`
   (`v1.0.1`, `v1.0.9`, затем `v1.1.0` и далее по схеме переноса).
3. **release**: генерирует ченжлог (`scripts/changelog.sh`), обновляет `CHANGELOG.md` в репозитории
   и публикует Release с `YawaChatHub.exe` и `YawaChatHub-Setup.exe`.

Один раз включите: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

## Следующий релиз

Версию вручную менять не нужно: обычный push в `main` выпускает версию из `VERSION`
и сразу записывает туда следующую. Правила переноса — в [README](../README.md#версии-и-авторелиз).
Для публичного changelog используйте префиксы `feat:`, `fix:`, `ui:` или `perf:` —
технические коммиты в описание релиза не попадают.

## Пересборка после изменений

**Portable exe распаковывает asar один раз** в `%TEMP%\YawaChatHub` (Windows)
и при следующем запуске переиспользует кэш — новые файлы НЕ подхватываются.

Перед запуском обновлённой сборки:
```powershell
# 1. Закрыть приложение (и убить зависшие процессы, если есть)
taskkill /IM YawaChatHub.exe /F 2>nul

# 2. Удалить кэш распаковки portable
rd /s /q "%TEMP%\YawaChatHub"

# 3. Запустить новый exe
```
