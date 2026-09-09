// Хранение настроек в settings.dat рядом с exe. Без реестра, без БД.
// Чувствительные поля (токены) шифруются — см. secure.js.
//
// secure.js подключается ЛЕНИВО (lazy require) при первом реальном
// использовании encrypt/decrypt/sealJson/openJson. Если модуль отсутствует
// в сборке — приложение работает, просто токены хранятся открытым текстом.
// Это гарантирует, что «Cannot find module ./secure» НИКОГДА не падает
// на верхнем уровне require (что убивало main process при старте).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let _secure = null;   // загруженный модуль или fallback
let _secLoaded = false;

/** Возвращает объект-обёртку над secure.js (реальный или fallback). */
function sec() {
  if (_secLoaded) return _secure;
  _secLoaded = true;
  try {
    _secure = require("./secure");
  } catch (e) {
    console.warn("[settings] secure.js недоступен, шифрование ОТКЛЮЧЕНО:", e && e.message ? e.message : e);
    _secure = {
      setKeyPath() {},
      setSafeStorage() {},
      isEncrypted: () => false,
      encrypt: (v) => String(v ?? ""),
      decrypt: (v) => String(v ?? ""),
      sealJson: (obj) => Buffer.from(JSON.stringify(obj), "utf8"),
      openJson: (buf) => (buf && buf.length ? JSON.parse(buf.toString("utf8")) : {}),
      isSealedBlob: () => false,
      writeFileSecure(p, data) {
        const tmp = `${p}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, data, { mode: 0o600 });
        try { fs.renameSync(tmp, p); } catch { fs.writeFileSync(p, data); }
      },
      hideFile() {},
      shredFile(p) { try { fs.unlinkSync(p); } catch { /* noop */ } },
    };
  }
  return _secure;
}

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
  bgOpacity: 70,
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
  compactRows: false,
  textShadow: true,
  textOutline: 0,
  textColor: "",
  nameColor: "",
  bgColor: "",
  border: true,
  bgImage: "",
};

const DEFAULT_OVERLAY = {
  enabled: false,
  bgOpacity: 55,
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
  showViewers: true,
  ttl: 0,
  rowGap: 6,
  textShadow: true,
  textOutline: 0,
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
  settingsSchemaVersion: 5,
  port: 47823,
  token: null,
  theme: "midnight",
  closeToTray: false,
  minimizeToTray: false,
  startHidden: false,
  youtubeApiKey: "",
  overlayBounds: null,
  channels: [],
  tts: null,
  chatView: null,
  widget: DEFAULT_WIDGET,
  overlay: DEFAULT_OVERLAY,
  hotkeys: DEFAULT_HOTKEYS,
  bot: {
    twitch: { enabled: false, token: "", account: "", channel: "", accountId: "", clientId: "" },
    vk: { enabled: false, token: "", account: "", channel: "", accountId: "" },
    commandsEnabled: true,
    commands: { twitch: [], vk: [] },
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
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "win32" && !process.argv[0].includes("electron")) {
    try { return path.dirname(process.execPath); } catch { /* noop */ }
  }
  return path.join(__dirname, "..");
}

function getSettingsPath(baseDir) {
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
  b.twitch.token = sec().decrypt(b.twitch.token || "");
  b.vk.token = sec().decrypt(b.vk.token || "");
  b.donationAlerts.token = sec().decrypt(b.donationAlerts.token || "");
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
  b.twitch.token = sec().encrypt(b.twitch.token || "");
  b.vk.token = sec().encrypt(b.vk.token || "");
  b.donationAlerts.token = sec().encrypt(b.donationAlerts.token || "");
  return copy;
}

function readSettingsFile(baseDir) {
  const file = getSettingsPath(baseDir);
  const legacy = getLegacySettingsPath(baseDir);
  let data = {};
  let migrated = false;
  try {
    data = sec().openJson(fs.readFileSync(file));
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
  sec().setKeyPath(path.join(baseDir || getBaseDir(), "settings.key"));
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
    sec().shredFile(getLegacySettingsPath(baseDir));
  }
  return settings;
}

/** Немедленная запись контейнера на диск (атомарно, через временный файл). */
function writeNow(settings, baseDir) {
  try {
    sec().setKeyPath(path.join(baseDir || getBaseDir(), "settings.key"));
    const toWrite = encryptSecretsCopy(settings);
    sec().writeFileSecure(getSettingsPath(baseDir), sec().sealJson(toWrite));
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

/** Передаёт electron.safeStorage в secure.js — вызывается после app.whenReady(). */
function initSafeStorage(ss) {
  try { sec().setSafeStorage(ss); } catch { /* noop */ }
}

module.exports = {
  DEFAULTS, DEFAULT_HOTKEYS, DEFAULT_WIDGET, DEFAULT_OVERLAY,
  getBaseDir, getSettingsPath, getLegacySettingsPath,
  loadSettings, saveSettings, flushSettings, initSafeStorage,
};
