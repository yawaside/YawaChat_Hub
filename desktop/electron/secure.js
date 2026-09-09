// Шифрование чувствительных данных пользователя (токены OAuth, секрет DonationAlerts).
//
// Зачем: раньше токены лежали в settings.json открытым текстом. Теперь каждое
// секретное поле шифруется AES-256-GCM с ключом, который привязан к конкретной
// машине и не покидает её. Ключ хранится отдельно от settings.json (settings.key),
// поэтому украденный settings.json без settings.key прочитать нельзя.
//
// Ключ: случайные 32 байта, генерируются один раз при первом запуске и фиксируются
// вместе с идентификатором машины (hostname + user), чтобы при переносе на другую
// машину данные не раскрывались.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const KEY_VERSION = "enc:v1:";
const ALGO = "aes-256-gcm";

let _keyPath = null;
let _key = null;

/** settings.js задаёт, где лежит файл ключа (рядом с exe / settings.json). */
function setKeyPath(p) {
  _keyPath = p;
}

function machineFingerprint() {
  const host = os.hostname() || "unknown";
  const user = (os.userInfo().username || "unknown");
  return `${process.platform}:${host}:${user}`;
}

function deriveKeyBytes() {
  // Секрет + отпечаток машины -> 32 байта. Так ключ не работает на другой машине.
  const secret = getAppKey(); // гарантирует, что файл ключа создан
  return crypto
    .createHash("sha256")
    .update(String(secret) + "::" + machineFingerprint())
    .digest();
}

function getAppKey() {
  if (_key) return _key;
  const kp = _keyPath || path.join(__dirname, "settings.key");
  try {
    _key = fs.readFileSync(kp, "utf8").trim();
  } catch {
    _key = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(kp, _key, { mode: 0o600 });
    } catch {
      try { fs.writeFileSync(kp, _key); } catch { /* noop */ }
    }
  }
  return _key;
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(KEY_VERSION);
}

function encrypt(plaintext) {
  const data = String(plaintext ?? "");
  if (!data) return data;
  if (isEncrypted(data)) return data; // защита от двойного шифрования
  const key = deriveKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv(12) | tag(16) | данные
  return KEY_VERSION + Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(value) {
  if (value === null || value === undefined) return value;
  if (!isEncrypted(value)) return value; // legacy-plaintext — читаем как есть
  try {
    const raw = Buffer.from(String(value).slice(KEY_VERSION.length), "base64");
    if (raw.length < 28) return "";
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const key = deriveKeyBytes();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    // Ключ не совпал (другая машина) или данные повреждены.
    return "";
  }
}

module.exports = { encrypt, decrypt, isEncrypted, setKeyPath, KEY_VERSION };
