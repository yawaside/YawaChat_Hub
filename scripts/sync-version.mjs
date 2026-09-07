// Синхронизирует версию Electron-пакета только в рабочей копии CI.
// Исходная версия релизной линии хранится в VERSION.
import fs from "node:fs";

// Тот же формат, что в scripts/bump-version.mjs и src/version.ts:
// major ≥ 0, minor и patch — одна цифра 0…9 (схема 1.0.0 → 1.0.9 → 1.1.0 → 1.9.9 → 2.0.0).
const VERSION_RE = /^(\d+)\.([0-9])\.([0-9])$/;

const version = process.argv[2]?.trim();
if (!VERSION_RE.test(version || "")) {
  throw new Error(
    `Некорректная версия: ${version || "не указана"}. Ожидается major.minor.patch, где minor и patch — одна цифра 0…9 (например 1.0.0).`
  );
}

const path = "desktop/package.json";
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
pkg.version = version;
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`Electron package version: ${version}`);
