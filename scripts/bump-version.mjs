#!/usr/bin/env node
/**
 * CLI для релизной линии YawaChatHub. Самодостаточный чистый JS — работает на
 * любом Node без поддержки TypeScript, поэтому используется в GitHub Actions.
 *
 * Схема: minor и patch — одна цифра 0…9, отсчёт начинается с 1.0.0.
 *   1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0 → 2.0.1 → …
 *
 * Использование:
 *   node scripts/bump-version.mjs <version>          # напечатать следующую версию
 *   node scripts/bump-version.mjs --check <version>  # только проверить формат
 *   node scripts/bump-version.mjs --read             # версия из файла VERSION
 *
 * Логика совпадает с bumpVersion() из src/version.ts; совпадение проверяет
 * scripts/check-release-versioning.cjs, чтобы обе копии не разошлись.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
export function readVersionFile(path = fileURLToPath(new URL("../VERSION", import.meta.url))) {
  return readFileSync(path, "utf8").trim();
}

const args = process.argv.slice(2);

if (args[0] === "--read") {
  try {
    process.stdout.write(`${readVersionFile()}\n`);
  } catch {
    console.error("Не удалось прочитать файл VERSION");
    process.exit(1);
  }
} else {
  const checkOnly = args[0] === "--check";
  const input = (checkOnly ? args[1] : args[0]) ?? "";
  try {
    const next = bumpVersion(input);
    if (checkOnly) console.log(`Версия ${input.trim()} корректна; следующая: ${next}`);
    else process.stdout.write(`${next}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
