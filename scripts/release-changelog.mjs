#!/usr/bin/env node
/**
 * Вставляет раздел версии в CHANGELOG.md.
 *
 * Если раздел уже есть (например, он подготовлен вручную), файл не меняется —
 * так curated-текст релиза не затирается автоматикой.
 *
 * Использование: node scripts/release-changelog.mjs <version> <notes.md> [CHANGELOG.md]
 * Печатает CHANGELOG, если он изменился, и «unchanged», если нет.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [version, notesFile, changelogFile = "CHANGELOG.md"] = process.argv.slice(2);
if (!version || !notesFile) {
  console.error("Использование: node scripts/release-changelog.mjs <version> <notes.md> [CHANGELOG.md]");
  process.exit(1);
}

const heading = `## YawaChatHub v${version}`;
const notes = readFileSync(notesFile, "utf8").replace(/\s+$/, "");
const original = existsSync(changelogFile) ? readFileSync(changelogFile, "utf8") : "";

if (original.split("\n").some(line => line.trim() === heading)) {
  console.log("unchanged");
  process.exit(0);
}

const lines = original.split("\n");
const firstSection = lines.findIndex(line => line.startsWith("## "));
const insertAt = firstSection === -1 ? lines.length : firstSection;
const next = [
  ...lines.slice(0, insertAt),
  notes,
  "",
  ...lines.slice(insertAt).filter((line, index) => !(index === 0 && line.trim() === "")),
].join("\n");

writeFileSync(changelogFile, next.replace(/\n{3,}/g, "\n\n"), "utf8");
console.log(`updated: добавлен раздел ${heading}`);
