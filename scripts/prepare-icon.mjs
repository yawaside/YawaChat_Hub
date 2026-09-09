#!/usr/bin/env node
/**
 * Генерирует ВСЕ растровые иконки приложения из кода:
 *
 *   desktop/build/icon.ico          — иконка exe, ярлыка и установщика (electron-builder);
 *   desktop/build/icon.png          — 256×256, запасной вариант для electron-builder;
 *   desktop/electron/assets/tray-16.png, tray-24.png, tray-32.png, app-256.png
 *                                   — иконки для рантайма (трей и окно).
 *
 * Почему рантайм-иконки лежат в `desktop/electron/assets`, а не в `desktop/build`:
 * в `desktop/package.json` → `build.files` упакованы только `electron/**`,
 * `renderer-dist/**` и `widget/**`. Каталог `build/` в asar НЕ попадает, поэтому
 * `path.join(__dirname, "..", "build", "icon.ico")` в собранном exe не существует —
 * именно из-за этого значок в трее оставался пустым. SVG использовать нельзя:
 * Electron `nativeImage` понимает только PNG и JPEG.
 *
 * Скрипт кроссплатформенный (чистый Node, без System.Drawing), поэтому работает
 * и на Windows-раннере, и локально на Linux/macOS.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = resolve(root, "desktop/build");
const assetsDir = resolve(root, "desktop/electron/assets");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TRAY_SIZES = [16, 24, 32];
const BAR_HEIGHTS = [0.44, 0.24, 0.34, 0.18]; // доли высоты — как у AudioWaveform в шапке
const SUPER = 4; // суперсэмплинг: на 16×16 края должны остаться читаемыми

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Расстояние до отрезка — полосы эквалайзера со скруглёнными концами. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Рисует бренд-иконку: скруглённая плашка с фиолетово-сиреневым градиентом
 * и белыми полосами эквалайзера по центру.
 *
 * @param {number} size    сторона в пикселях
 * @param {boolean} contrast на маленьких размерах полосы делаем толще,
 *                           иначе в трее иконка превращается в пятно
 */
function renderRgba(size, contrast = false) {
  const rgba = new Uint8Array(size * size * 4);
  const radius = size * 0.24;
  const barWidth = size * (contrast ? 0.145 : 0.115);
  const barRadius = barWidth / 2;
  const gap = size * (contrast ? 0.055 : 0.072);
  const bars = BAR_HEIGHTS.length;
  const totalWidth = bars * barWidth + (bars - 1) * gap;
  const startX = (size - totalWidth) / 2;
  const step = 1 / SUPER;
  const samples = SUPER * SUPER;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let sy = 0; sy < SUPER; sy++) {
        for (let sx = 0; sx < SUPER; sx++) {
          const px = x + (sx + 0.5) * step;
          const py = y + (sy + 0.5) * step;

          // плашка со скруглёнными углами
          const qx = Math.max(radius - px, px - (size - radius), 0);
          const qy = Math.max(radius - py, py - (size - radius), 0);
          if (Math.hypot(qx, qy) > radius) continue;

          // диагональный градиент 135°: #8b5cf6 → #a78bfa
          const t = clamp01((px + py) / (2 * size));
          let r = 0x8b + (0xa7 - 0x8b) * t;
          let g = 0x5c + (0x8b - 0x5c) * t;
          let b = 0xf6 + (0xfa - 0xf6) * t;

          for (let i = 0; i < bars; i++) {
            const bx = startX + i * (barWidth + gap) + barRadius;
            const height = BAR_HEIGHTS[i] * size;
            const cy = size / 2;
            const top = cy - height / 2 + barRadius;
            const bottom = cy + height / 2 - barRadius;
            if (segmentDistance(px, py, bx, top, bx, bottom) <= barRadius) {
              r = 255;
              g = 255;
              b = 255;
              break;
            }
          }

          alpha += 1 / samples;
          red += r / samples;
          green += g / samples;
          blue += b / samples;
        }
      }

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(red);
      rgba[offset + 1] = Math.round(green);
      rgba[offset + 2] = Math.round(blue);
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

/* ---------- PNG ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // глубина
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // фильтр None
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- ICO (кадры со сжатием PNG, формат Vista+) ---------- */

function encodeIco(frames) {
  const dir = Buffer.alloc(6 + frames.length * 16);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(frames.length, 4);

  let offset = dir.length;
  frames.forEach((frame, i) => {
    const entry = dir.subarray(6 + i * 16, 6 + (i + 1) * 16);
    const dim = frame.size >= 256 ? 0 : frame.size; // 0 означает 256
    entry[0] = dim;
    entry[1] = dim;
    entry[2] = 0; // палитра не используется
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // планы
    entry.writeUInt16LE(32, 6); // бит на пиксель
    entry.writeUInt32LE(frame.bytes.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.bytes.length;
  });

  return Buffer.concat([dir, ...frames.map((f) => f.bytes)]);
}

/* ---------- запись ---------- */

mkdirSync(buildDir, { recursive: true });
mkdirSync(assetsDir, { recursive: true });

const icoFrames = ICO_SIZES.map((size) => ({
  size,
  bytes: encodePng(size, renderRgba(size, size <= 32)),
}));
writeFileSync(resolve(buildDir, "icon.ico"), encodeIco(icoFrames));
writeFileSync(resolve(buildDir, "icon.png"), encodePng(256, renderRgba(256)));

// Рантайм-иконки: попадают в asar вместе с electron/**.
for (const size of TRAY_SIZES) {
  writeFileSync(resolve(assetsDir, `tray-${size}.png`), encodePng(size, renderRgba(size, true)));
}
writeFileSync(resolve(assetsDir, "app-256.png"), encodePng(256, renderRgba(256)));

console.log(
  [
    `desktop/build/icon.ico  — ${ICO_SIZES.join("/")}`,
    "desktop/build/icon.png  — 256×256",
    `desktop/electron/assets/tray-{${TRAY_SIZES.join(",")}}.png — иконки трея (внутри asar)`,
    "desktop/electron/assets/app-256.png — иконка окна (внутри asar)",
  ].join("\n")
);
