#!/usr/bin/env node
// desktop/scripts/verify-before-build.cjs
// Проверяет, что electron/main.js не содержит жёсткого require("./secure")
// и что settings.js грузит secure лениво. Запускается перед electron-builder.
const fs = require("fs");
const path = require("path");

let ok = true;
const warn = (msg) => { console.error(`\x1b[33m⚠ ${msg}\x1b[0m`); };
const fail = (msg) => { console.error(`\x1b[31m✗ ${msg}\x1b[0m`); ok = false; };
const pass = (msg) => console.log(`\x1b[32m✓ ${msg}\x1b[0m`);

const mainSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
const settingsSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "settings.js"), "utf8");

// main.js: не должно быть require("./secure") на верхнем уровне
const mainLines = mainSrc.split("\n");
for (let i = 0; i < mainLines.length; i++) {
  const line = mainLines[i];
  if (/require\(\s*["']\.\/secure["']\s*\)/.test(line) && !/^\s*\/\//.test(line)) {
    fail(`main.js:${i + 1}: найден require("./secure") на верхнем уровне — приложение упадёт!`);
  }
}
if (ok) pass("main.js: нет жёсткого require('./secure')");

// settings.js: не должно быть require("./secure") вне функции sec()
const settingsLines = settingsSrc.split("\n");
let inFunction = 0;
let foundLazy = false;
for (let i = 0; i < settingsLines.length; i++) {
  const line = settingsLines[i];
  if (/function\s+sec\s*\(/.test(line)) { inFunction++; foundLazy = true; }
  if (/require\(\s*["']\.\/secure["']\s*\)/.test(line)) {
    if (!foundLazy || inFunction === 0) {
      // Допустимо только внутри функции sec()
      if (!/function\s+sec\s*\(/.test(line) && !/^\s*\/\//.test(line)) {
        fail(`settings.js:${i + 1}: require("./secure") вне ленивой функции sec()`);
      }
    }
  }
}
if (foundLazy) pass("settings.js: secure загружается лениво через sec()");
else fail("settings.js: не найдена ленивая функция sec() — secure загружается при старте!");

// secure.js: должен существовать
const securePath = path.join(__dirname, "..", "electron", "secure.js");
if (fs.existsSync(securePath)) pass("secure.js: файл существует");
else warn("secure.js: файл отсутствует — шифрование будет отключено (не критично)");

process.exit(ok ? 0 : 1);
