// Шифрование данных пользователя (токены OAuth, секрет DonationAlerts) и
// всего файла настроек целиком.
//
// Схема защиты (v2):
//   1. Мастер-секрет — 32 случайных байта. Хранится в файле `settings.key`.
//      На Windows/macOS/Linux с доступным хранилищем ОС файл ключа сам
//      зашифрован через Electron `safeStorage` (DPAPI / Keychain / libsecret):
//      без входа в учётную запись пользователя ключ не читается.
//   2. Рабочий ключ = scrypt(мастер-секрет + отпечаток машины, соль).
//      Отпечаток: платформа, hostname, имя пользователя, домашний каталог.
//      Перенос settings.dat + settings.key на другой ПК ничего не даёт.
//   3. Каждое значение шифруется AES-256-GCM (случайный IV, тег подлинности):
//      подмена/порча данных обнаруживается, одинаковые данные дают разный шифртекст.
//   4. Файлы ключа и настроек получают режим 0600 и атрибут «скрытый» на Windows.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const KEY_VERSION = "enc:v1:"; // legacy: sha256(secret+fingerprint)
const KEY_VERSION_2 = "enc:v2:"; // scrypt(secret+fingerprint, salt)
const BLOB_MAGIC = "YWCH2"; // заголовок зашифрованного файла настроек
const ALGO = "aes-256-gcm";
const SCRYPT_SALT = "yawachathub.settings.v2";

let _keyPath = null;
let _secret = null; // hex-строка мастер-секрета
let _keyV1 = null;
let _keyV2 = null;
let _safeStorage = null;

/** settings.js задаёт, где лежит файл ключа (рядом с exe / settings.dat). */
function setKeyPath(p) {
  if (_keyPath !== p) {
    _keyPath = p;
    _secret = null;
    _keyV1 = null;
    _keyV2 = null;
  }
}

/** Опционально: main.js передаёт electron.safeStorage после app.whenReady(). */
function setSafeStorage(ss) {
  try {
    _safeStorage = ss && typeof ss.isEncryptionAvailable === "function" && ss.isEncryptionAvailable() ? ss : null;
  } catch {
    _safeStorage = null;
  }
  // Если ключ уже был записан открытым, «доворачиваем» его в защищённое хранилище.
  if (_safeStorage && _secret && _keyPath) {
    try {
      const raw = fs.readFileSync(_keyPath, "utf8").trim();
      if (!raw.startsWith("os:")) writeKeyFile(_secret);
    } catch { /* noop */ }
  }
}

function machineFingerprint() {
  let user = "unknown";
  let home = "";
  try {
    const info = os.userInfo();
    user = info.username || "unknown";
    home = info.homedir || "";
  } catch { /* noop */ }
  return `${process.platform}:${os.hostname() || "unknown"}:${user}:${home}`;
}

/* ---------------- защита файлов на диске ---------------- */

function hideFile(p) {
  try { fs.chmodSync(p, 0o600); } catch { /* noop */ }
  if (process.platform === "win32") {
    try { execFile("attrib", ["+h", p], { windowsHide: true }, () => {}); } catch { /* noop */ }
  }
}

function writeFileSecure(p, data) {
  // На Windows запись в скрытый файл через writeFile может падать с EPERM —
  // поэтому пишем во временный файл и переименовываем поверх.
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  try {
    fs.renameSync(tmp, p);
  } catch {
    try { fs.unlinkSync(p); } catch { /* noop */ }
    fs.renameSync(tmp, p);
  }
  hideFile(p);
}

/* ---------------- мастер-секрет ---------------- */

function writeKeyFile(secretHex) {
  const kp = _keyPath || path.join(__dirname, "settings.key");
  let payload = secretHex;
  if (_safeStorage) {
    try {
      payload = "os:" + _safeStorage.encryptString(secretHex).toString("base64");
    } catch { payload = secretHex; }
  }
  try {
    writeFileSecure(kp, payload);
  } catch {
    try { fs.writeFileSync(kp, payload); } catch { /* noop */ }
  }
}

function readKeyFile() {
  const kp = _keyPath || path.join(__dirname, "settings.key");
  const raw = fs.readFileSync(kp, "utf8").trim();
  if (!raw) throw new Error("empty key");
  if (raw.startsWith("os:")) {
    if (!_safeStorage) throw new Error("os keystore unavailable");
    return _safeStorage.decryptString(Buffer.from(raw.slice(3), "base64")).trim();
  }
  return raw;
}

function getAppKey() {
  if (_secret) return _secret;
  try {
    _secret = readKeyFile();
  } catch {
    _secret = crypto.randomBytes(32).toString("hex");
    writeKeyFile(_secret);
  }
  return _secret;
}

function keyV1() {
  if (_keyV1) return _keyV1;
  _keyV1 = crypto.createHash("sha256").update(String(getAppKey()) + "::" + machineFingerprint()).digest();
  return _keyV1;
}

function keyV2() {
  if (_keyV2) return _keyV2;
  _keyV2 = crypto.scryptSync(String(getAppKey()) + "::" + machineFingerprint(), SCRYPT_SALT, 32, {
    N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return _keyV2;
}

/* ---------------- примитивы ---------------- */

function sealBuffer(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  // iv(12) | tag(16) | данные
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function openBuffer(raw, key) {
  if (raw.length < 28) throw new Error("short");
  const decipher = crypto.createDecipheriv(ALGO, key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

function isEncrypted(value) {
  return typeof value === "string" && (value.startsWith(KEY_VERSION_2) || value.startsWith(KEY_VERSION));
}

function encrypt(plaintext) {
  const data = String(plaintext ?? "");
  if (!data) return data;
  if (isEncrypted(data)) return data; // защита от двойного шифрования
  return KEY_VERSION_2 + sealBuffer(Buffer.from(data, "utf8"), keyV2()).toString("base64");
}

function decrypt(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string" || !isEncrypted(value)) return value; // legacy-plaintext
  try {
    if (value.startsWith(KEY_VERSION_2)) {
      return openBuffer(Buffer.from(value.slice(KEY_VERSION_2.length), "base64"), keyV2()).toString("utf8");
    }
    return openBuffer(Buffer.from(value.slice(KEY_VERSION.length), "base64"), keyV1()).toString("utf8");
  } catch {
    // Ключ не совпал (другая машина) или данные повреждены.
    return "";
  }
}

/* ---------------- целый файл настроек ---------------- */

/** JSON-объект → зашифрованный бинарный блоб (magic + iv + tag + данные). */
function sealJson(obj) {
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([Buffer.from(BLOB_MAGIC, "ascii"), sealBuffer(plain, keyV2())]);
}

/** Зашифрованный блоб или legacy JSON → объект. Бросает при повреждении. */
function openJson(buf) {
  if (!buf || !buf.length) return {};
  if (buf.length > BLOB_MAGIC.length && buf.subarray(0, BLOB_MAGIC.length).toString("ascii") === BLOB_MAGIC) {
    return JSON.parse(openBuffer(buf.subarray(BLOB_MAGIC.length), keyV2()).toString("utf8"));
  }
  // Старый формат: открытый JSON.
  return JSON.parse(buf.toString("utf8"));
}

function isSealedBlob(buf) {
  return Boolean(buf && buf.length > BLOB_MAGIC.length && buf.subarray(0, BLOB_MAGIC.length).toString("ascii") === BLOB_MAGIC);
}

/** Безопасное затирание файла: перезапись случайными байтами + удаление. */
function shredFile(p) {
  try {
    const size = fs.statSync(p).size;
    if (size > 0 && size < 16 * 1024 * 1024) fs.writeFileSync(p, crypto.randomBytes(size));
  } catch { /* noop */ }
  try { fs.unlinkSync(p); } catch { /* noop */ }
}

module.exports = {
  encrypt, decrypt, isEncrypted, setKeyPath, setSafeStorage,
  sealJson, openJson, isSealedBlob, writeFileSecure, hideFile, shredFile,
  KEY_VERSION, KEY_VERSION_2,
};
