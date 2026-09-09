// Хранение настроек в settings.json рядом с exe. Без реестра, без БД.
// Никакого шифрования: токены хранятся как есть (по решению — защита снята).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  settingsSchemaVersion: 4,
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
  return path.join(baseDir || getBaseDir(), "settings.json");
}

function normalizeBot(settings) {
  const b = settings.bot || (settings.bot = {});
  const ensure = (o) => (o && typeof o === "object" ? o : {});
  b.twitch = { ...DEFAULTS.bot.twitch, ...ensure(b.twitch) };
  b.vk = { ...DEFAULTS.bot.vk, ...ensure(b.vk) };
  b.donationAlerts = { ...DEFAULTS.bot.donationAlerts, ...ensure(b.donationAlerts) };
}

function loadSettings(baseDir) {
  const file = getSettingsPath(baseDir);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* первый запуск / нет файла */
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = {};

  const settings = {
    ...DEFAULTS,
    ...data,
    chatView: { ...DEFAULT_CHAT_VIEW, ...(data.chatView || {}) },
    widget: { ...DEFAULT_WIDGET, ...(data.widget || {}) },
    overlay: { ...DEFAULT_OVERLAY, ...(data.overlay || {}) },
    hotkeys: { ...DEFAULT_HOTKEYS, ...(data.hotkeys || {}) },
    bot: { ...DEFAULTS.bot, ...(data.bot || {}) },
  };
  normalizeBot(settings);

  const migrateToV3 = Number(data.settingsSchemaVersion || 0) < 3;
  settings.closeToTray = migrateToV3 ? false : settings.closeToTray === true;
  settings.settingsSchemaVersion = 4;
  settings.minimizeToTray = settings.minimizeToTray === true;
  settings.startHidden = settings.startHidden === true;

  if (!settings.token) {
    settings.token = "yawa_" + crypto.randomBytes(6).toString("hex");
    writeNow(settings, baseDir);
  } else if (migrateToV3) {
    writeNow(settings, baseDir);
  }
  return settings;
}

/** Немедленная запись settings.json (атомарно, через временный файл). */
function writeNow(settings, baseDir) {
  try {
    const file = getSettingsPath(baseDir);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf8"); }
  } catch (e) {
    console.error("[settings] не удалось записать settings.json:", e.message);
  }
}

/* Отложенная запись: интерфейс шлёт patch на каждое движение ползунка.
   Объединяем в одну запись не чаще раза в 400 мс; при выходе — flushSettings(). */
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
  getBaseDir, getSettingsPath, loadSettings, saveSettings, flushSettings,
};
