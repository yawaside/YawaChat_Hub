#!/usr/bin/env node
/**
 * Единая точка работы с версией YawaChatHub. Самодостаточный чистый JS —
 * работает на любом Node без поддержки TypeScript, поэтому годится и для CI.
 *
 * Схема: minor и patch — одна цифра 0…9, отсчёт с 1.0.0.
 *   1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0 → 2.0.1 → …
 *
 * Команды:
 *   node scripts/bump-version.mjs <version>          напечатать следующую версию
 *   node scripts/bump-version.mjs --check <version>  проверить формат
 *   node scripts/bump-version.mjs --read             версия из файла VERSION
 *   node scripts/bump-version.mjs --apply            поднять версию и записать её
 *                                                    в VERSION и desktop/package.json
 *   node scripts/bump-version.mjs --set <version>    записать конкретную версию
 *   node scripts/bump-version.mjs --verify           убедиться, что версии совпадают
 *
 * Логика переноса продублирована в src/version.ts (bumpVersion) — совпадение
 * проверяет scripts/check-release-versioning.cjs, чтобы копии не разошлись.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_FILE = resolve(root, "VERSION");
const DESKTOP_PKG = resolve(root, "desktop/package.json");
const VERSION_TS = resolve(root, "src/version.ts");

/** Каждый из трёх сегментов: major ≥ 0, minor 0…9, patch 0…9. */
const VERSION_RE = /^(\d+)\.([0-9])\.([0-9])$/;

/** Разбирает строку версии; бросает понятную ошибку вместо тихой порчи тега. */
export function parseVersion(input) {
  const text = String(input ?? "").trim();
  const match = VERSION_RE.exec(text);
  if (!match) {
    throw new Error(
      `Некорректная версия: «${text || "пусто"}». Ожидается major.minor.patch, где minor и patch — одна цифра 0…9 (например 1.0.0).`
    );
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Следующая версия с переносом: 1.0.9 → 1.1.0, 1.9.9 → 2.0.0. */
export function bumpVersion(input) {
  const { major, minor, patch } = parseVersion(input);
  if (patch < 9) return `${major}.${minor}.${patch + 1}`;
  if (minor < 9) return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
}

/** Версия из файла VERSION — кандидат на следующий релиз. */
export function readVersionFile() {
  return readFileSync(VERSION_FILE, "utf8").trim();
}

/** Версия Electron-пакета: попадает в свойства exe и в about-панель. */
export function readDesktopVersion() {
  return JSON.parse(readFileSync(DESKTOP_PKG, "utf8")).version;
}

/** Запасное значение версии в src/version.ts — его видит интерфейс без CI. */
export function readSourceVersion() {
  // Берём именно запасное значение после `.trim() ||`, а не пустую строку
  // из выражения с переменными окружения перед ним.
  const match = /\.trim\(\)\s*\|\|\s*"([^"]+)"/.exec(readFileSync(VERSION_TS, "utf8"));
  return match ? match[1] : "";
}

/**
 * Пишет версию сразу во все места, где она встречается: файл VERSION,
 * desktop/package.json и запасное значение в src/version.ts.
 * Раньше они правились по отдельности и приложение показывало не тот номер,
 * что стоял в релизе.
 */
export function writeVersion(version) {
  parseVersion(version);
  writeFileSync(VERSION_FILE, `${version}\n`, "utf8");

  const pkg = JSON.parse(readFileSync(DESKTOP_PKG, "utf8"));
  pkg.version = version;
  writeFileSync(DESKTOP_PKG, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const source = readFileSync(VERSION_TS, "utf8");
  const updated = source.replace(
    /(export const APP_VERSION = \(process\.env\.NEXT_PUBLIC_APP_VERSION \|\| process\.env\.VITE_APP_VERSION \|\| ""\)\.trim\(\) \|\| ")[^"]*(";)/,
    `$1${version}$2`
  );
  if (updated === source && !source.includes(`|| "${version}"`)) {
    throw new Error("Не удалось обновить запасную версию в src/version.ts");
  }
  writeFileSync(VERSION_TS, updated, "utf8");
  return version;
}

const args = process.argv.slice(2);
const command = args[0];

try {
  if (command === "--read") {
    process.stdout.write(`${readVersionFile()}\n`);
  } else if (command === "--apply") {
    const next = bumpVersion(readVersionFile());
    writeVersion(next);
    console.log(`Версия поднята: ${next} (VERSION и desktop/package.json)`);
  } else if (command === "--set") {
    writeVersion(String(args[1] ?? "").trim());
    console.log(`Версия установлена: ${args[1]} (VERSION и desktop/package.json)`);
  } else if (command === "--verify") {
    const file = readVersionFile();
    parseVersion(file);
    const places = [
      ["desktop/package.json", readDesktopVersion()],
      ["src/version.ts", readSourceVersion()],
    ];
    const drift = places.filter(([, value]) => value !== file);
    if (drift.length) {
      throw new Error(
        `Версии разошлись с VERSION = ${file}: ` +
          drift.map(([name, value]) => `${name} = ${value}`).join(", ") +
          `. Выполните: npm run version:set ${file}`
      );
    }
    console.log(`Версия согласована во всех файлах: ${file}`);
  } else if (command === "--check") {
    const input = String(args[1] ?? "").trim();
    console.log(`Версия ${input} корректна; следующая: ${bumpVersion(input)}`);
  } else {
    process.stdout.write(`${bumpVersion(String(command ?? "").trim())}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
