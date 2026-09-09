// Хранение настроек в settings.dat рядом с exe. Без реестра, без БД.
// Чувствительные поля (токены) шифруются — см. secure.js.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * secure.js подключаем БЕЗ жёсткого require на верхнем уровне: если файл по
 * какой-то причине не попал в сборку (битый asar, карантин антивируса), модуль
 * деградирует в «открытое хранение» и приложение ЗАПУСКАЕТСЯ, а не падает с
 * «Cannot find module './secure'» в main process. В консоль пишется предупреждение.
 */
let secure = null;
try {
  secure = require("./secure");
} catch (e) {
  console.warn("[settings] secure.js недоступен — шифрование настроек ОТКЛЮЧЕНО:", e && e.message ? e.message : e);
}
if (!secure) {
  secure = {
    setKeyPath() {},
    setSafeStorage() {},
    isEncrypted: () => false,
    encrypt: (v) => v,
    decrypt: (v) => v,
    sealJson: (obj) => Buffer.from(JSON.stringify(obj), "utf8"),
    openJson: (buf) => (buf && buf.length ? JSON.parse(buf.toString("utf8")) : {}),
    isSealedBlob: () => false,
    writeFileSecure: (p, data) => {
      const tmp = `${p}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      try { fs.renameSync(tmp, p); } catch { fs.writeFileSync(p, data); }
    },
    hideFile() {},
    shredFile(p) { try { fs.unlinkSync(p); } catch { /* noop */ } },
  };
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
};
