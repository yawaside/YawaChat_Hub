// Хранение настроек рядом с exe. Без реестра, без БД.
//
// Файл настроек — зашифрованный контейнер settings.dat (AES-256-GCM), поверх
// него токены площадок шифруются вторым слоем. Криптография намеренно живёт
// В ЭТОМ ЖЕ файле, а не в отдельном модуле: отдельный файл легко «потерять»
// при публикации репозитория, и тогда упакованное приложение падает с
// «Cannot find module ./secure» ещё до появления окна.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

/* ============================================================
   Шифрование данных пользователя
   ------------------------------------------------------------
   1. Мастер-секрет — 32 случайных байта в файле settings.key.
      Если доступно хранилище ОС (DPAPI / Keychain / libsecret), сам файл
      ключа зашифрован через Electron safeStorage.
   2. Рабочий ключ = scrypt(мастер-секрет + отпечаток машины).
      Перенос settings.dat + settings.key на другой ПК ничего не даёт.
   3. AES-256-GCM: случайный IV и тег подлинности на каждое значение.
   4. Файлы получают режим 0600 и атрибут «скрытый» на Windows.
   ============================================================ */
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
  // N=2^14 — надёжно против перебора и при этом ~30 мс: настройки читаются
  // до появления окна, и более тяжёлый параметр заметно задерживал старт
  // портативной сборки.
  _keyV2 = crypto.scryptSync(String(getAppKey()) + "::" + machineFingerprint(), SCRYPT_SALT, 32, {
    N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
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

const secure = {
  encrypt, decrypt, isEncrypted, setKeyPath, setSafeStorage,
  sealJson, openJson, isSealedBlob, writeFileSecure, hideFile, shredFile,
};


const DEFAULT_HOTKEYS = {
  "overlay:toggle": "Control+Shift+G",
  "overlay:clicks": "Control+Shift+C",
  "tts:toggle": "Control+Shift+T",
  "tts:pause": "Control+Shift+P",
  "tts:skip": "Control+Shift+S",
  "tts:clear": "Control+Shift+Q",
  "window:toggle": "Control+Shift+H",
  "feed:clear": "Control+Shift+L",
};

const DEFAULT_WIDGET = {
  style: "clean",
  theme: "minimal-dark",
  fontSize: 16,
  bgOpacity: 70, // прозрачность ТОЛЬКО подложки
  radius: 12,
  duration: 8,
  dir: "up",
  shadow: true,
  showPlatform: true,
  showTime: true,
  maxMessages: 8,
  effect: "slide-up",
  effectDuration: 0.32,
  rowGap: 6,
  compactRows: false, // компактные строки: минимальный отступ плашки в виджете
  textShadow: true, // мягкая тень под текстом сообщений
  textOutline: 0, // толщина чёрной обводки текста, px (0 — выкл)
  textColor: "",
  nameColor: "",
  bgColor: "",
  border: true,
  bgImage: "",
};

const DEFAULT_OVERLAY = {
  enabled: false,
  bgOpacity: 55, // прозрачность подложки оверлея, текст остаётся чётким
  clickThrough: false,
  mode: "compact",
  fontSize: 12,
  maxMessages: 6,
  locked: false,
  style: "clean",
  showBorder: true,
  effect: "slide-up",
  effectDuration: 0.3,
  textColor: "",
  nameColor: "",
  bgColor: "",
  radius: 14,
  bgImage: "",
  showTime: false,
  showPlatform: true,
  showViewers: true, // онлайн подключённых площадок внизу оверлея
  ttl: 0, // сколько секунд живёт сообщение в оверлее (0 — не скрывать)
  rowGap: 6, // отступ между сообщениями оверлея, px
  textShadow: true, // мягкая тень под текстом сообщений
  textOutline: 0, // толщина чёрной обводки текста, px (0 — выкл)
};

const DEFAULT_CHAT_VIEW = {
  style: "classic",
  fontSize: 15,
  rowGap: 6,
  radius: 16,
  padding: 12,
  feedPadding: 20,
  bubble: true,
  showPlatform: true,
  showTime: true,
  showBadges: true,
  messageEffect: "slide-up",
  effectDuration: 0.34,
};

const DEFAULTS = {
  settingsSchemaVersion: 4,
  port: 47823,
  token: null, // генерируется при первом запуске
  theme: "midnight",
  /* Поведение окна управляется из интерфейса и из меню трея. */
  closeToTray: false, // по умолчанию крестик завершает приложение
  minimizeToTray: false, // кнопка «минус» сворачивает в трей (иначе на панель задач)
  startHidden: false, // не показывать окно при старте
  // YouTube читается без Data API (внутренний endpoint, как в браузере).
  // Ключ больше не нужен — поле оставлено только для совместимости со старыми конфигами.
  youtubeApiKey: "",
  overlayBounds: null, // позиция и размер окна оверлея
  channels: [],
  tts: null, // заполняется из интерфейса: { enabled, rate, volume, voiceURI, template, filters }
  chatView: null, // вид ленты
  widget: DEFAULT_WIDGET,
  overlay: DEFAULT_OVERLAY,
  hotkeys: DEFAULT_HOTKEYS,
  /* Настройки чат-бота (Twitch/VK/команды/модерация/DonationAlerts).
     Сами токены и ключи — из desktop/electron/app-config.js (GitHub), не из settings.json. */
  bot: {
    twitch: { enabled: false, token: "", account: "", channel: "", accountId: "", clientId: "" },
    vk: { enabled: false, token: "", account: "", channel: "", accountId: "" },
    commandsEnabled: true,
    commands: { twitch: [], vk: [] },
    /* DonationAlerts — канал трансляции: подключается по токену из профиля. */
    donationAlerts: {
      enabled: false,
      token: "",
      currency: "RUB",
      template: "",
      totalSession: 0,
    },
  },
};

function getBaseDir() {
  // portable-сборка electron-builder выставляет PORTABLE_EXECUTABLE_DIR
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "win32" && !process.argv[0].includes("electron")) {
    try {
      return path.dirname(process.execPath);
    } catch {
      /* noop */
    }
  }
  return path.join(__dirname, "..");
}

function getSettingsPath(baseDir) {
  // Зашифрованный контейнер настроек (см. secure.js). Старый settings.json
  // читается один раз для миграции и затем безвозвратно затирается.
  return path.join(baseDir || getBaseDir(), "settings.dat");
}

function getLegacySettingsPath(baseDir) {
  return path.join(baseDir || getBaseDir(), "settings.json");
}

/** Нормализует структуру бота и расшифровывает секретные поля в память. */
function decryptSecrets(settings) {
  const b = settings.bot || (settings.bot = {});
  const ensure = (o) => (o && typeof o === "object" ? o : {});
  b.twitch = { ...DEFAULTS.bot.twitch, ...ensure(b.twitch) };
  b.vk = { ...DEFAULTS.bot.vk, ...ensure(b.vk) };
  b.donationAlerts = { ...DEFAULTS.bot.donationAlerts, ...ensure(b.donationAlerts) };
  b.twitch.token = secure.decrypt(b.twitch.token || "");
  b.vk.token = secure.decrypt(b.vk.token || "");
  b.donationAlerts.token = secure.decrypt(b.donationAlerts.token || "");
}

/**
 * Копия настроек с зашифрованными секретами. Токены шифруются отдельно
 * (второй слой поверх шифрования всего файла) — даже при частичной утечке
 * расшифрованного контейнера ключи площадок остаются закрыты.
 */
function encryptSecretsCopy(settings) {
  const copy = JSON.parse(JSON.stringify(settings));
  const b = copy.bot || (copy.bot = {});
  const ensure = (o) => (o && typeof o === "object" ? o : {});
  b.twitch = { ...DEFAULTS.bot.twitch, ...ensure(b.twitch) };
  b.vk = { ...DEFAULTS.bot.vk, ...ensure(b.vk) };
  b.donationAlerts = { ...DEFAULTS.bot.donationAlerts, ...ensure(b.donationAlerts) };
  b.twitch.token = secure.encrypt(b.twitch.token || "");
  b.vk.token = secure.encrypt(b.vk.token || "");
  b.donationAlerts.token = secure.encrypt(b.donationAlerts.token || "");
  return copy;
}

function readSettingsFile(baseDir) {
  const file = getSettingsPath(baseDir);
  const legacy = getLegacySettingsPath(baseDir);
  let data = {};
  let migrated = false;
  try {
    data = secure.openJson(fs.readFileSync(file));
  } catch {
    // Нет контейнера или он повреждён — пробуем старый открытый settings.json.
    try {
      data = JSON.parse(fs.readFileSync(legacy, "utf8"));
      migrated = true;
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
  return { data, migrated };
}

function loadSettings(baseDir) {
  secure.setKeyPath(path.join(baseDir || getBaseDir(), "settings.key"));
  const { data, migrated } = readSettingsFile(baseDir);
  const settings = {
    ...DEFAULTS,
    ...data,
    chatView: { ...DEFAULT_CHAT_VIEW, ...(data.chatView || {}) },
    widget: { ...DEFAULT_WIDGET, ...(data.widget || {}) },
    overlay: { ...DEFAULT_OVERLAY, ...(data.overlay || {}) },
    hotkeys: { ...DEFAULT_HOTKEYS, ...(data.hotkeys || {}) },
    bot: { ...DEFAULTS.bot, ...(data.bot || {}) },
  };
  // Токены расшифровываем в память, чтобы бот работал с открытым значением.
  decryptSecrets(settings);
  // В 3.0 настройка закрытия в трей стала выключена по умолчанию. Старый конфиг
  // мигрирует один раз, затем выбор пользователя снова сохраняется как обычно.
  const migrateToV3 = Number(data.settingsSchemaVersion || 0) < 3;
  settings.closeToTray = migrateToV3 ? false : settings.closeToTray === true;
  settings.settingsSchemaVersion = 5;
  settings.minimizeToTray = settings.minimizeToTray === true;
  settings.startHidden = settings.startHidden === true;
  if (!settings.token) settings.token = "yawa_" + crypto.randomBytes(6).toString("hex");
  if (!data.token || migrateToV3 || migrated || Number(data.settingsSchemaVersion || 0) < 5) {
    writeNow(settings, baseDir);
  }
  if (migrated) {
    // Открытый settings.json больше не нужен — затираем, чтобы токены не остались на диске.
    secure.shredFile(getLegacySettingsPath(baseDir));
  }
  return settings;
}

/** Немедленная запись контейнера на диск (атомарно, через временный файл). */
function writeNow(settings, baseDir) {
  try {
    secure.setKeyPath(path.join(baseDir || getBaseDir(), "settings.key"));
    const toWrite = encryptSecretsCopy(settings);
    secure.writeFileSecure(getSettingsPath(baseDir), secure.sealJson(toWrite));
  } catch (e) {
    console.error("[settings] не удалось записать settings.dat:", e.message);
  }
}

/* Отложенная запись: интерфейс шлёт patch на каждое движение ползунка, а
   шифрование + запись на диск при каждом вызове давали всплески CPU/IO.
   Теперь запись объединяется в одну не чаще раза в 400 мс; при выходе —
   flushSettings(). */
let _pending = null;
let _timer = null;

function saveSettings(settings, baseDir) {
  _pending = { settings, baseDir };
  if (_timer) return;
  _timer = setTimeout(() => {
    _timer = null;
    flushSettings();
  }, 400);
}

function flushSettings() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (!_pending) return;
  const { settings, baseDir } = _pending;
  _pending = null;
  writeNow(settings, baseDir);
}

module.exports = {
  DEFAULTS, DEFAULT_HOTKEYS, DEFAULT_WIDGET, DEFAULT_OVERLAY,
  getBaseDir, getSettingsPath, getLegacySettingsPath, loadSettings, saveSettings, flushSettings,
  /* Криптография настроек: main.js передаёт сюда safeStorage после app.whenReady().
     Экспортируем из этого же модуля, чтобы не заводить отдельный файл. */
  secure, setSafeStorage, encrypt, decrypt, KEY_VERSION, KEY_VERSION_2,
};
