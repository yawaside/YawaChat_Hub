/**
 * Единственный источник правды о версии YawaChatHub внутри приложения.
 *
 * Схема релизной линии: каждая цифра minor и patch ограничена девяткой.
 *   1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0 → 2.0.1 → …
 *
 * Число в файле VERSION — версия, которая будет выпущена следующим пушем в main.
 * GitHub Actions берёт её оттуда, а после релиза записывает туда уже следующую
 * (см. scripts/bump-version.mjs и .github/workflows/release.yml).
 *
 * Next.js подставляет NEXT_PUBLIC_APP_VERSION на этапе сборки;
 * Vite (рендерер для Electron) — VITE_APP_VERSION через `define` в vite.config.ts.
 */

export const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || process.env.VITE_APP_VERSION || "").trim() || "1.0.7";
export const APP_TAG = `v${APP_VERSION}`;
export const APP_NAME = "YawaChatHub";

/** Последняя версия, в которой minor и patch ещё умещаются в одну цифру. */
export const APP_VERSION_MAX = "1.9.9";

/** Каждый из трёх сегментов: major ≥ 0, minor 0…9, patch 0…9. */
const VERSION_RE = /^(\d+)\.([0-9])\.([0-9])$/;

/** Разбирает строку версии; бросает понятную ошибку вместо тихой порчи тега. */
export function parseVersion(input: string): { major: number; minor: number; patch: number; text: string } {
  const text = String(input ?? "").trim();
  const match = VERSION_RE.exec(text);
  if (!match) {
    throw new Error(
      `Некорректная версия: «${text || "пусто"}». Ожидается формат major.minor.patch, где minor и patch — одна цифра 0…9 (например 1.0.0).`
    );
  }
  const [, major, minor, patch] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), text };
}

/** Следующая версия с переносом: 1.0.9 → 1.1.0, 1.9.9 → 2.0.0. */
export function bumpVersion(input: string): string {
  const { major, minor, patch } = parseVersion(input);
  if (patch < 9) return `${major}.${minor}.${patch + 1}`;
  if (minor < 9) return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
}

export const APP_CHANNEL = "portable x64";
