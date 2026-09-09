// YawaChatHub — главный процесс Electron.
// Окна: главное (приложение целиком) + игровой оверлей (always-on-top, click-through, drag).
// Системный трей, глобальные горячие клавиши, локальный сервер виджета, SAPI TTS.
//
// FIX(2.0.0): «Сворачивать в трей при закрытии» — рабочая настройка.
//   Раньше переключатель в интерфейсе был заглушкой: он всегда показывал «включено»
//   и только выводил тост про settings.json. Теперь closeToTray читается из
//   settings.json при каждом закрытии окна, меняется из интерфейса (settings:patch)
//   и из меню трея, а крестик честно завершает приложение, когда настройка выключена.
// TLS-инспекция антивирусов и корпоративных прокси.
//
// Почему нужна глобальная настройка для «сырого» Node, а не только точечные
// агенты (net.js): чат-библиотеки (tiktok-live-connector, vklive-message-client)
// открывают СОБСТВЕННЫЕ WebSocket/HTTPS соединения, в которые агент не
// пробросить. Если здесь не ослабить проверку, у пользователей с антивирусом,
// инспектирующим TLS, перестанут подключаться Twitch, Kick, VK и TikTok —
// соединения падают с "unable to verify the first certificate".
//
// Chromium (Electron `net`) в этой ситуации не страдает: он доверяет системному
// хранилищу Windows, куда антивирус добавляет свой корневой сертификат.
//
// Безопасность: приложение читает ТОЛЬКО публичные чаты, через эти соединения
// не передаётся ни ключей, ни логинов. Переменная влияет лишь на процесс
// Electron и не затрагивает другие программы, поэтому риски ограничены.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell, safeStorage } = require("electron");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { getBaseDir, loadSettings, saveSettings, flushSettings } = require("./settings");
const secure = require("./secure");
const { startWidgetServer } = require("./widgetServer");
const { ConnectorManager } = require("./connectors");
const { BotManager } = require("./bot");
const { TtsEngine } = require("./tts");
const { warmupEdge, disposeEdge } = require("./edgeTts");
const { closeNet, installCertificateHandler, request } = require("./net");
const { APP_CONFIG } = require("./app-config");

const baseDir = getBaseDir();
const settings = loadSettings(baseDir);

// Одинаковое имя в заголовке, трее, списке приложений и Диспетчере задач.
/* Экономия ресурсов Chromium.

   Приложение — это чат-лента, а не браузер: тяжёлые подсистемы нам не нужны.
   Отключаем то, что в простое греет CPU и держит память, но не трогаем
   аппаратное ускорение — без него отрисовка ленты и оверлея станет дороже. */
app.commandLine.appendSwitch("disable-features", [
  "CalculateNativeWinOcclusion", // фоновой расчёт перекрытия окон
  "MediaSessionService",         // интеграция с системным плеером
  "HardwareMediaKeyHandling",    // перехват мультимедийных клавиш — конфликтует с плеерами
  "WebRtcHideLocalIpsWithMdns",
].join(","));
// ВАЖНО: js-flags применяется КО ВСЕМ процессам Chromium, включая рендерер.
// Лимит 128 МБ заставлял сборщик мусора окна работать почти непрерывно —
// лента дёргалась при прокрутке и активном чате. Ограничиваем кучу только
// главного процесса (ему хватает 192 МБ), окно живёт с настройками по умолчанию,
// а рост памяти ленты ограничен числом сообщений в интерфейсе.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=192 --no-expose-wasm");
// Фоновые вкладки и скрытые окна не должны получать полноценный таймер.
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// Обрабатываем ошибки сертификатов точечно: доверяем локальной TLS-инспекции
// только на известных чат-хостах, всё остальное отклоняем как обычно.
installCertificateHandler(app);

app.setName("YawaChatHub");
app.setAppUserModelId("chat.yawa.hub");

app.setAboutPanelOptions?.({ applicationName: "YawaChatHub", applicationVersion: settings.version || "" });

let mainWin = null;
let overlayWin = null;
let tray = null;
let widgetServer = null;
let hotkeyConflicts = [];
let connectors = null;
let bot = null;
const tts = new TtsEngine();

/* ---------------- OAuth (системный браузер → приложение) ----------------
 * Схема (как в Streamer.bot и аналогах):
 *  1. Пользователь нажимает «Авторизоваться».
 *  2. Открывается СИСТЕМНЫЙ браузер (shell.openExternal) со страницей входа
 *     Twitch/VK. Redirect URI — сайт yawachathub.netlify.app (Twitch не
 *     поддерживает custom-схемы в redirect, только https).
 *  3. После выдачи разрешений браузер возвращается на сайт:
 *       — Twitch (implicit flow): #access_token=…&state=…
 *       — VK (OAuth 2.1 + PKCE):  ?code=…&state=…&device_id=…
 *  4. Сайт (OAuthCallback.tsx) НИЧЕГО не показывает пользователю и передаёт
 *     данные в локальный сервер приложения (127.0.0.1:17563) вместе со state.
 *  5. Локальный сервер сверяет state (защита от CSRF):
 *       — Twitch: сразу передаёт токен в бота;
 *       — VK: обменивает code на access_token сам (POST id.vk.ru/oauth2/auth
 *         с сохранённым code_verifier — сайт этот секрет никогда не видит),
 *         затем передаёт токен в бота.
 *     После этого сервер сам возвращает фокус в окно приложения.
 * state привязан к площадке и случаю — чужой сайт не сможет подложить токен.
 */
const pendingOAuth = {}; // platform -> { state, verifier? } (verifier только для VK PKCE)

/** code_verifier для PKCE: 43-128 URL-safe символов (RFC 7636). */
function pkceVerifier() {
  return crypto.randomBytes(64).toString("base64url").slice(0, 128);
}
/** code_challenge = BASE64URL(SHA256(code_verifier)), метод S256. */
function pkceChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// Вторая копия не поднимает второй сервер виджета и второй набор коннекторов —
// иначе занят порт, дублируются сообщения и конфликтуют горячие клавиши.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Пользователь запустил ярлык ещё раз (или сработал yawachat://) —
    // показываем уже открытое окно.
    if (!mainWin || mainWin.isDestroyed()) return;
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  });
}

// macOS: кастомная схема yawachat:// доставляется событием open-url —
// возвращаем фокус в окно (запасной путь возврата из браузера).
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (String(url || "").startsWith("yawachat://")) showMainWindow();
});

const RENDERER = path.join(__dirname, "..", "renderer-dist", "index.html");

// Иконки рантайма лежат в electron/assets/** и поэтому ГАРАНТИРОВАННО попадают
// в asar: в package.json → build.files упакованы только electron/**, renderer-dist/**
// и widget/**. Каталог desktop/build/ в сборку не входит, и обращение к
// ../build/icon.ico в упакованном приложении не находило файл — из-за этого значок
// в трее оставался пустым. SVG тоже не годится: nativeImage читает только PNG и JPEG.
// Файлы создаёт scripts/prepare-icon.mjs.
const ICON_DIR = path.join(__dirname, "assets");

/** Иконка окна и «О программе» — 256×256 PNG. */
function appIcon() {
  const icon = nativeImage.createFromPath(path.join(ICON_DIR, "app-256.png"));
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

/**
 * Иконка трея. Windows масштабирует значок под текущий DPI, поэтому отдаём
 * готовые растры 16/24/32 одним изображением: система сама берёт нужный.
 * Так значок остаётся резким и на 100%, и на 150% масштабе.
 */
function trayIcon() {
  const base = nativeImage.createFromPath(path.join(ICON_DIR, "tray-16.png"));
  if (base.isEmpty()) return appIcon(); // повреждён ресурс — лучше окно-иконка, чем пусто
  for (const [size, scale] of [[24, 1.5], [32, 2]]) {
    const extra = nativeImage.createFromPath(path.join(ICON_DIR, `tray-${size}.png`));
    if (!extra.isEmpty()) base.addRepresentation({ scaleFactor: scale, buffer: extra.toPNG() });
  }
  base.setTemplateImage(false); // цветной значок, не монохромный шаблон macOS
  return base;
}

/**
 * Рассылка в окна.
 *
 * Поток чата довольно плотный, а оверлей большую часть времени скрыт.
 * Раньше каждое сообщение уходило в оба окна: скрытый оверлей всё равно
 * получал IPC, парсил и держал сообщения в памяти. Теперь события чата
 * не идут в невидимый оверлей, а служебные (настройки, статусы) — идут всегда.
 */
const FEED_CHANNELS = new Set(["sp:chat", "sp:channels"]);

function broadcast(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (FEED_CHANNELS.has(channel) && !overlayWin.isVisible()) return;
  overlayWin.webContents.send(channel, payload);
}

function persist() {
  saveSettings(settings, baseDir);
}

/**
 * Настройки для интерфейса — БЕЗ секретов. Токены OAuth и ключ DonationAlerts
 * живут только в главном процессе: окну они не нужны, а любая XSS/уязвимость
 * рендерера не должна давать доступ к аккаунтам площадок.
 */
function publicSettings() {
  const copy = { ...settings };
  if (copy.bot && typeof copy.bot === "object") {
    const b = { ...copy.bot };
    for (const k of ["twitch", "vk", "donationAlerts"]) {
      if (b[k] && typeof b[k] === "object") b[k] = { ...b[k], token: b[k].token ? "•••" : "" };
    }
    copy.bot = b;
  }
  return copy;
}

/* Ползунки интерфейса шлют patch десятки раз в секунду. Перестроение меню
   трея и рассылка полного объекта настроек на каждый тик давали скачки CPU —
   объединяем в один вызов раз в 120 мс. */
let settingsNotifyTimer = null;
function notifySettingsChanged() {
  if (settingsNotifyTimer) return;
  settingsNotifyTimer = setTimeout(() => {
    settingsNotifyTimer = null;
    refreshTrayMenu();
    broadcast("sp:settings", publicSettings());
  }, 120);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu());
}

/* ---------------- окна ---------------- */

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#06060b",
    title: "YawaChatHub",
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webSecurity: false, // нужен для загрузки 7TV/BTTV/FFZ смайлов из file://
      // Когда окно свёрнуто в трей, таймеры рендерера засыпают: в простое
      // приложение почти не тратит CPU. Лента догоняет себя при показе окна.
      backgroundThrottling: true,
      spellcheck: false, // словари занимают память и не нужны — полей ввода мало
      devTools: !app.isPackaged,
    },
  });
  mainWin.loadFile(RENDERER, { hash: "/app" });
  mainWin.once("ready-to-show", () => {
    if (!settings.startHidden) mainWin.show();
  });

  // Внешние ссылки (GitHub, DonationAlerts, YouTube, Twitch, VK — «О программе»,
  // ссылки в сообщениях) открываем в БРАУЗЕРЕ ПО УМОЛЧАНИЮ, а не в новом окне
  // Electron. target=_blank перехватывается setWindowOpenHandler, обычный клик —
  // will-navigate. Внутренние file://-страницы пропускаем как есть.
  const isExternalHttp = (url) => /^https?:\/\//i.test(String(url || ""));
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttp(url) && !String(url).startsWith("http://127.0.0.1")) {
      shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWin.webContents.on("will-navigate", (event, url) => {
    if (isExternalHttp(url)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // уведомляем рендерер о развёрнутости — иконка кнопки «во весь экран»
  mainWin.on("maximize", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:maximize", true);
  });
  mainWin.on("unmaximize", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:maximize", false);
  });

  // FIX: сворачивание в трей теперь учитывает текущее значение closeToTray
  mainWin.on("close", (e) => {
    if (settings.closeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWin.hide();
      if (tray) tray.displayBalloon({
        title: "YawaChatHub",
        content: "Приложение свёрнуто в трей. Двойной клик по иконке — открыть окно.",
      });
      return;
    }
    app.isQuitting = true;
  });

  mainWin.on("closed", () => {
    mainWin = null;
    app.isQuitting = true;
    app.quit();
  });
}

/**
 * Уровень «поверх всех окон».
 *
 * "screen-saver" — самый высокий уровень Windows: оверлей перекрывает не только
 * игру, но и панели других программ (Discord, GeForce Experience, MSI Afterburner,
 * системные диалоги UAC). Пользователи жалуются, что «окно лезет поверх всего».
 * Поэтому по умолчанию используем обычный "normal": окно остаётся над игрой,
 * но не воюет с другими оверлеями. Кто хочет прежнее поведение — включает
 * overlay.aggressiveTop в настройках.
 */
function applyAlwaysOnTop(win) {
  if (!win || win.isDestroyed()) return;
  const level = settings.overlay.aggressiveTop ? "screen-saver" : "normal";
  win.setAlwaysOnTop(true, level);
}

function applyOverlayFlags() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // Прозрачность — только у подложки (CSS в рендерере), окно остаётся opacity=1,
  // иначе бледнел бы и текст сообщений.
  overlayWin.setOpacity(1);
  overlayWin.setIgnoreMouseEvents(!!settings.overlay.clickThrough, { forward: true });
  // FIX: окно нельзя было двигать — перетаскивание идёт через CSS-регион в рендерере,
  // поэтому здесь окно всегда «подвижное», кроме явной фиксации позиции.
  overlayWin.setMovable(!settings.overlay.locked);
  overlayWin.setResizable(!settings.overlay.locked && !settings.overlay.clickThrough);
  applyAlwaysOnTop(overlayWin);
  // конфиг уходит именно в окно оверлея — иначе настройки «не применялись»
  overlayWin.webContents.send("sp:overlay", settings.overlay);
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:overlay", settings.overlay);
}

function createOverlayWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const saved = settings.overlayBounds || {};
  overlayWin = new BrowserWindow({
    width: saved.width || 360,
    height: saved.height || 440,
    x: Number.isInteger(saved.x) ? saved.x : area.width - 390,
    y: Number.isInteger(saved.y) ? saved.y : 40,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    // Пока оверлей скрыт, окно не рисуется и не тратит GPU/CPU.
    paintWhenInitiallyHidden: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      webSecurity: false,
      // Оверлей поверх игры обязан обновляться, даже когда не в фокусе,
      // иначе сообщения замирают во время полноэкранной игры.
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  applyAlwaysOnTop(overlayWin);
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadFile(RENDERER, { hash: "/overlay" });
  overlayWin.on("closed", () => (overlayWin = null));
  overlayWin.webContents.on("did-finish-load", applyOverlayFlags);

  // запоминаем позицию и размер окна оверлея
  const remember = () => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    settings.overlayBounds = overlayWin.getBounds();
    persist();
  };
  overlayWin.on("moved", remember);
  overlayWin.on("resized", remember);

  if (settings.overlay.enabled) overlayWin.showInactive();
}

function toggleOverlay(force) {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlayWindow();
  const show = force !== undefined ? force : !overlayWin.isVisible();
  if (show) {
    overlayWin.showInactive();
    // Пока оверлей был скрыт, обновления каналов ему не отправлялись —
    // отдаём актуальный список сразу после показа.
    if (connectors && !overlayWin.isDestroyed()) {
      overlayWin.webContents.send("sp:channels", connectors.list());
    }
  } else {
    overlayWin.hide();
  }
  settings.overlay.enabled = show;
  persist();
  applyOverlayFlags();
}

function toggleClickThrough() {
  settings.overlay.clickThrough = !settings.overlay.clickThrough;
  persist();
  applyOverlayFlags();
}

function toggleCloseToTray() {
  settings.closeToTray = !settings.closeToTray;
  persist();
  refreshTrayMenu();
  broadcast("sp:settings", publicSettings());
}

/* ---------------- трей ---------------- */

const sendHotkey = (action) => broadcast("sp:hotkey", action);

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: "Открыть YawaChatHub", click: showMainWindow },
    { label: "Свернуть окно в трей", click: () => mainWin && mainWin.hide() },
    { type: "separator" },
    {
      label: "Сворачивать в трей при закрытии",
      type: "checkbox",
      checked: !!settings.closeToTray,
      click: toggleCloseToTray,
    },
    { type: "separator" },
    { label: "Озвучка вкл/выкл", click: () => sendHotkey("tts:toggle") },
    { label: "Пропустить текущее", click: () => sendHotkey("tts:skip") },
    { label: "Очистить очередь", click: () => sendHotkey("tts:clear") },
    { type: "separator" },
    { label: "Игровой оверлей вкл/выкл", click: () => toggleOverlay() },
    { label: "Сквозные клики вкл/выкл", click: () => toggleClickThrough() },
    { type: "separator" },
    { label: "Выход", click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createTray() {
  // Значок берём из electron/assets/** — этот каталог упакован в asar,
  // поэтому иконка есть и в portable, и в установленной сборке.
  tray = new Tray(trayIcon());
  tray.setToolTip(`YawaChatHub ${app.getVersion()}`);
  tray.setContextMenu(trayMenu());
  // Один клик — привычное поведение значка в трее Windows; двойной оставляем тоже.
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

/* ---------------- горячие клавиши ---------------- */

/**
 * Локальный приёмник авторизации. Привязан к 127.0.0.1 — наружу не выходит.
 * Сайт передаёт сюда данные площадки (POST) + state; мы сверяем state и
 * прокидываем итоговый токен в бота. Пользователю токен нигде не показываем.
 *
 *  — Twitch: сайт присылает { token, state } — implicit flow, токен готов сразу.
 *  — VK:     сайт присылает { code, device_id, state } — мы сами обмениваем
 *            code на access_token через id.vk.ru/oauth2/auth, используя
 *            code_verifier, сохранённый в pendingOAuth (сайт его не видит).
 */
function startOAuthServer() {
  const { host, port } = APP_CONFIG.oauthBridge;
  const CORS_HEADERS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "*",
    // Chrome/Edge требуют этот заголовок для запросов с https-страницы
    // к локальному адресу (Private Network Access) — без него запрос сайта
    // отбрасывается ещё до нашего обработчика.
    "access-control-allow-private-network": "true",
    "access-control-max-age": "86400",
  };

  const server = http.createServer((req, res) => {
    const u = new URL(String(req.url || ""), `http://${host}:${port}`);
    const m = /^\/auth\/(twitch|vk)$/.exec(u.pathname);
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (!m) {
      res.writeHead(404, { ...CORS_HEADERS, "content-type": "text/plain; charset=utf-8" });
      res.end("YawaChatHub OAuth relay");
      return;
    }
    const platform = m[1];

    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
    req.on("end", async () => {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch {
        try { payload = Object.fromEntries(new URLSearchParams(body)); } catch { /* noop */ }
      }
      const pick = (k) => String((payload && payload[k]) || u.searchParams.get(k) || "").trim();
      const result = await completeOAuth(platform, {
        token: pick("access_token") || pick("token"),
        code: pick("code"),
        deviceId: pick("device_id"),
        state: pick("state"),
        error: pick("error_description") || pick("error"),
      });
      const ok = result && result.ok;
      res.writeHead(ok ? 200 : 400, { ...CORS_HEADERS, "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        ok: Boolean(ok),
        title: ok ? `${platform === "twitch" ? "Twitch" : "VK"} подключён` : "Авторизация не удалась",
        message: ok ? "Фокус возвращён в YawaChatHub" : (result && result.error) || "",
      }));
    });
  });

  server.on("error", () => {});
  server.listen(port, host);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const local = {
    "overlay:toggle": () => toggleOverlay(),
    "overlay:clicks": () => toggleClickThrough(),
    "window:toggle": () => {
      if (!mainWin) return;
      mainWin.isVisible() ? mainWin.hide() : showMainWindow();
    },
  };
  // Сочетание может быть уже занято другой программой (Discord, OBS, Steam,
  // раскладка клавиатуры). Раньше это молча игнорировалось и выглядело как
  // «клавиши не работают». Теперь собираем список и показываем его в интерфейсе.
  const conflicts = [];
  for (const [action, accelerator] of Object.entries(settings.hotkeys)) {
    if (!accelerator) continue;
    try {
      const ok = globalShortcut.register(accelerator, () =>
        local[action] ? local[action]() : sendHotkey(action)
      );
      if (!ok || !globalShortcut.isRegistered(accelerator)) conflicts.push({ action, accelerator });
    } catch (e) {
      conflicts.push({ action, accelerator, error: e.message });
    }
  }
  hotkeyConflicts = conflicts;
  if (conflicts.length) {
    console.warn(
      "[hotkeys] заняты другой программой:",
      conflicts.map((c) => `${c.action} = ${c.accelerator}`).join(", ")
    );
  }
  broadcast("sp:hotkey-conflicts", conflicts);
}

function mergeDonationChannel(list) {
  const rest = (list || []).filter((c) => c.platform !== "donation");
  const da = bot && bot.donationChannel ? bot.donationChannel() : null;
  return da ? [da, ...rest] : rest;
}

/* ---------------- IPC ---------------- */

ipcMain.on("channels:add", (_e, c) => {
  if (!c) return;
  if (c.platform === "donation") {
    bot?.connectDonationAlerts(c.channelId);
    return;
  }
  connectors?.add(c.platform, c.channelId);
});
ipcMain.on("channels:remove", (_e, c) => {
  if (!c) return;
  if (c.platform === "donation") {
    bot?.removeDonationChannel();
    return;
  }
  connectors?.remove(c.platform, c.channelId);
  // Отключение канала Twitch/VK, который был добавлен через авторизацию, —
  // это полный выход: токен удаляется, бот отключается, статус «не авторизован».
  if (bot && (c.platform === "twitch" || c.platform === "vk")) {
    const norm = (s) => String(s || "").trim().toLowerCase().replace(/^[@#]/, "");
    const cfg = bot.botConfig(c.platform);
    const isAuthChannel = cfg.token && (!cfg.channel || norm(cfg.channel) === norm(c.channelId));
    if (isAuthChannel) bot.revoke(c.platform);
    else bot.onChannelRemoved(c.platform, c.channelId);
  }
});
ipcMain.handle("channels:list", () => mergeDonationChannel(connectors ? connectors.list() : []));
ipcMain.on("net:diagnose", () => connectors && connectors.diagnose());

/* ============================================================
   IPC — чат-бот
   ============================================================ */
ipcMain.handle("bot:status", () => (bot ? bot.snapshot() : []));

ipcMain.handle("bot:save", (_e, patch) => {
  if (!bot) return false;
  if (patch.donationAlerts) {
    bot.saveDa(patch.donationAlerts);
    if (patch.donationAlerts.enabled === false) bot.stopDonationAlerts();
    else bot.startDonationAlerts();
  }
  if (patch.commandsEnabled !== undefined) bot.commandsEnabled = !!patch.commandsEnabled;
  persist();
  bot.flushStatus();
  return true;
});

ipcMain.on("bot:connect", (_e, platform) => bot && bot.connect(platform));
ipcMain.on("bot:disconnect", (_e, platform) => bot && bot.disconnect(platform));

ipcMain.handle("bot:commands", (_e, platform) => (bot ? bot.listCommands(platform) : []));
ipcMain.handle("bot:command:add", (_e, { platform, command }) => {
  if (!bot) return { error: "Бот не запущен" };
  try { return bot.addCommand(platform, command || {}); }
  catch (e) { return { error: String(e.message || e) }; }
});
ipcMain.on("bot:command:remove", (_e, { platform, id }) => bot && bot.removeCommand(platform, id));

ipcMain.handle("bot:send", (_e, { platform, channel, text }) => (bot ? bot.sendChat(platform, channel, text) : false));

ipcMain.handle("bot:moderate", async (_e, payload) =>
  bot ? bot.moderate(payload ? payload.platform : null, payload || {}) : { ok: false, error: "Бот не запущен" });

ipcMain.handle("bot:timeouts", (_e, platform) => (bot ? bot.timeoutOptions(platform) : []));

ipcMain.handle("bot:donation", () => (bot ? bot.donationInfo() : { currency: "RUB", total: 0, connected: false }));
ipcMain.on("bot:donation:currency", (_e, currency) => bot && bot.setDonationCurrency(currency));
ipcMain.on("bot:donation:reset", () => bot && bot.resetDonationTotal());
ipcMain.on("bot:donation:connect", (_e, { token, currency }) => bot && bot.connectDonationAlerts(token, currency));

/* ============================================================
   Авторизация по площадкам — окно приложения, без сайта-редиректа
   ============================================================ */
ipcMain.handle("oauth:start", (_e, platform) => {
  if (platform !== "twitch" && platform !== "vk") return { ok: false, error: "Неизвестная площадка" };
  if (!bot) return { ok: false, error: "Чат-бот ещё запускается" };
  const cfg = platform === "twitch" ? APP_CONFIG.twitch : APP_CONFIG.vk;
  if (!cfg.clientId) {
    return { ok: false, error: platform === "twitch" ? "Не задан Client ID Twitch" : "Не задан ID приложения VK" };
  }
  // state = площадка + случайные 16 байт; сайт отдаст его обратно, сверяем.
  const state = `${platform}.${crypto.randomBytes(16).toString("hex")}`;
  const redirect = encodeURIComponent(APP_CONFIG.redirectUrl);
  let url;
  if (platform === "twitch") {
    pendingOAuth.twitch = { state, startedAt: Date.now() };
    // Twitch: implicit flow (у Twitch нет PKCE для publicclient) — токен приходит прямо в hash.
    url = `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(cfg.clientId)}`
      + `&redirect_uri=${redirect}&response_type=token`
      + `&scope=${encodeURIComponent(cfg.scopes.join(" "))}`
      + `&state=${encodeURIComponent(state)}&force_verify=true`;
  } else {
    // VK ID (OAuth 2.1): старый implicit-flow (oauth.vk.com?response_type=token)
    // отключён и всегда отдаёт Security Error. Актуальная схема — Authorization
    // Code + PKCE через id.vk.ru. code_verifier храним только в main-процессе:
    // сайт получает лишь code+state и никогда не видит verifier и итоговый токен.
    const verifier = pkceVerifier();
    const challenge = pkceChallenge(verifier);
    pendingOAuth.vk = { state, verifier, startedAt: Date.now() };
    url = `https://id.vk.ru/authorize?response_type=code&client_id=${encodeURIComponent(cfg.clientId)}`
      + `&redirect_uri=${redirect}`
      + `&scope=${encodeURIComponent(cfg.scopes.join(" "))}`
      + `&state=${encodeURIComponent(state)}`
      + `&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`;
  }
  // Вход выполняется в отдельном окне самого приложения: мы видим адрес
  // редиректа напрямую и забираем code/token из него. Это надёжнее прежней
  // схемы «сайт → fetch на 127.0.0.1»: современные браузеры блокируют запрос
  // с https-страницы к локальному адресу (Private Network Access), из-за чего
  // VK-авторизация проходила на сайте, но в приложение не попадала.
  openAuthWindow(platform, url);
  return { ok: true };
});

/* ---------------- окно авторизации ---------------- */

let authWin = null;

/** Достаёт code/token/state из адреса редиректа площадки. */
function parseAuthRedirect(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const from = (str) => new URLSearchParams(String(str || "").replace(/^[#?]/, ""));
  const q = u.searchParams;
  const h = from(u.hash);
  const pick = (k) => q.get(k) || h.get(k) || "";
  // VK ID иногда кладёт всё в JSON-параметр payload.
  let payload = {};
  const rawPayload = pick("payload");
  if (rawPayload) { try { payload = JSON.parse(rawPayload); } catch { /* noop */ } }
  const get = (k) => payload[k] || pick(k);
  return {
    token: get("access_token") || get("token"),
    code: get("code"),
    deviceId: get("device_id"),
    state: get("state"),
    error: get("error_description") || get("error"),
  };
}

function closeAuthWindow() {
  const w = authWin;
  authWin = null;
  if (w && !w.isDestroyed()) {
    try { w.destroy(); } catch { /* noop */ }
  }
}

function openAuthWindow(platform, url) {
  closeAuthWindow();
  const title = platform === "twitch" ? "Вход через Twitch" : "Вход через VK";
  authWin = new BrowserWindow({
    width: 620,
    height: 760,
    title,
    autoHideMenuBar: true,
    backgroundColor: "#0b0d16",
    parent: mainWin && !mainWin.isDestroyed() ? mainWin : undefined,
    modal: false,
    webPreferences: {
      partition: `yawaauth:${platform}`, // отдельная сессия: чужие куки не подмешиваются
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  let finished = false;
  const finish = async (info) => {
    if (finished) return;
    finished = true;
    closeAuthWindow();
    await completeOAuth(platform, info);
  };

  const inspect = (target) => {
    const redirect = String(APP_CONFIG.redirectUrl || "");
    if (!target || !redirect || !String(target).startsWith(redirect.split("?")[0])) return false;
    const parsed = parseAuthRedirect(target);
    if (!parsed) return false;
    if (!parsed.code && !parsed.token && !parsed.error) return false;
    finish(parsed);
    return true;
  };

  const wc = authWin.webContents;
  const guard = (event, target) => { if (inspect(target)) { try { event.preventDefault(); } catch { /* noop */ } } };
  wc.on("will-redirect", guard);
  wc.on("will-navigate", guard);
  wc.on("did-navigate", (_e, target) => inspect(target));
  wc.on("did-navigate-in-page", (_e, target) => inspect(target));
  // Ссылки «открыть в новом окне» внутри формы входа держим в этом же окне.
  wc.setWindowOpenHandler(({ url: target }) => (inspect(target) ? { action: "deny" } : { action: "allow" }));

  authWin.on("closed", () => {
    authWin = null;
    if (!finished) {
      finished = true;
      delete pendingOAuth[platform];
      broadcast("sp:oauth-error", { platform, error: "Окно входа закрыто до завершения" });
    }
  });

  authWin.loadURL(url).catch((e) => {
    finish({ error: String(e && e.message ? e.message : e) });
  });
  authWin.show();
}

/**
 * Общий финал авторизации для обоих путей доставки (окно приложения и
 * запасной локальный мост): проверка state → получение токена → бот.
 */
async function completeOAuth(platform, info) {
  const expected = pendingOAuth[platform];
  const fail = (message) => {
    delete pendingOAuth[platform];
    console.warn(`[oauth] ${platform}: ${message}`);
    broadcast("sp:oauth-error", { platform, error: String(message).slice(0, 200) });
    showMainWindow();
    return { ok: false, error: String(message) };
  };
  if (!bot) return fail("Чат-бот ещё запускается — повторите вход");
  if (info && info.error) return fail(info.error);
  if (!expected) return fail("Сессия входа не найдена — повторите вход");
  if (info.state && expected.state !== info.state) return fail("Проверка state не прошла — повторите вход");
  if (Date.now() - (expected.startedAt || 0) > 15 * 60 * 1000) return fail("Сессия входа устарела — повторите вход");

  try {
    if (platform === "twitch") {
      const token = String(info.token || "").trim();
      if (!token) throw new Error("Twitch не вернул access_token");
      delete pendingOAuth[platform];
      await bot.handleOAuthToken(platform, token);
    } else {
      const code = String(info.code || "").trim();
      if (!code) throw new Error("VK не вернул authorization code");
      if (!expected.verifier) throw new Error("Сессия авторизации устарела — повторите вход");
      const { accessToken, userId } = await exchangeVkCode({
        code,
        deviceId: info.deviceId,
        state: info.state || expected.state,
        verifier: expected.verifier,
      });
      delete pendingOAuth[platform];
      await bot.handleOAuthToken(platform, accessToken, { userId });
    }
  } catch (error) {
    return fail(error && error.message ? error.message : error);
  }
  showMainWindow();
  return { ok: true };
}

/** VK: обмен authorization code на access_token (OAuth 2.1 + PKCE). */
async function exchangeVkCode({ code, deviceId, state, verifier }) {
  const cfg = APP_CONFIG.vk;
  const params = {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: cfg.clientId,
    redirect_uri: APP_CONFIG.redirectUrl,
    device_id: deviceId || "",
    state: state || "",
  };
  if (cfg.clientSecret) params.client_secret = cfg.clientSecret;
  const body = new URLSearchParams(params).toString();
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  let lastReason = "";
  for (const host of ["https://id.vk.ru", "https://id.vk.com"]) {
    const res = await request(`${host}/oauth2/auth`, { method: "POST", headers, body, timeout: 12000 });
    let data = null;
    try { data = JSON.parse(res.body || "{}"); } catch { /* noop */ }
    if (data && data.access_token) return { accessToken: data.access_token, userId: data.user_id };
    lastReason = (data && (data.error_description || data.error)) || `HTTP ${res.status}`;
  }
  throw new Error(`VK не выдал токен: ${lastReason}`);
}

ipcMain.handle("oauth:state", () => (bot ? bot.authState() : []));
ipcMain.handle("oauth:revoke", (_e, platform) => { if (bot) bot.revoke(platform); return true; });
/* Ручной ввод токена — запасной путь, если браузерный вход недоступен. */
ipcMain.handle("oauth:submit", async (_e, { platform, token }) => {
  if (!bot || !platform || !token) return false;
  await bot.handleOAuthToken(platform, String(token).trim());
  return true;
});

ipcMain.handle("settings:get", () => publicSettings());
ipcMain.on("settings:patch", (_e, patch) => {
  if (!patch || typeof patch !== "object") return;
  // Секреты и служебные поля из окна менять нельзя.
  const { bot: _bot, token: _token, ...safe } = patch;
  Object.assign(settings, safe);
  persist();
  notifySettingsChanged();
});

ipcMain.handle("hotkeys:conflicts", () => hotkeyConflicts);
ipcMain.on("hotkeys:apply", (_e, map) => {
  settings.hotkeys = { ...settings.hotkeys, ...map };
  persist();
  registerHotkeys();
});

/* управление главным окном: свернуть / скрыть в трей / во весь экран / закрыть */
ipcMain.on("window:minimize", () => {
  if (!mainWin) return;
  if (settings.minimizeToTray) mainWin.hide();
  else mainWin.minimize();
});
ipcMain.on("window:hide-to-tray", () => mainWin && mainWin.hide());
ipcMain.on("window:toggle-maximize", () => {
  if (!mainWin) return;
  if (mainWin.isMaximized()) mainWin.unmaximize();
  else mainWin.maximize();
});
ipcMain.handle("window:is-maximized", () => (mainWin ? mainWin.isMaximized() : false));
ipcMain.on("window:close", () => {
  if (!mainWin) {
    app.isQuitting = true;
    app.quit();
    return;
  }
  if (settings.closeToTray) {
    mainWin.hide();
  } else {
    app.isQuitting = true;
    app.quit();
  }
});

tts.onEnd = (id) => broadcast("sp:tts-end", id);
// Edge-фразы играет главное окно (Chromium), а не отдельный PowerShell-плеер:
// это убирает 0.5–1.5 с задержки и постоянную нагрузку от WPF-процессов.
// Шлём ТОЛЬКО в mainWin, иначе оверлей проиграл бы ту же фразу вторым голосом.
tts.onAudio = (payload) => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:tts-audio", payload);
  else tts.audioDone(payload && payload.id); // окна нет — не блокируем очередь
};
ipcMain.on("tts:audio-done", (_e, id) => tts.audioDone(id));
ipcMain.on("tts:speak", (_e, payload) => tts.speak(payload));
ipcMain.on("tts:skip", () => {
  tts.skip();
  broadcast("sp:tts-stop", null); // остановить <audio> в окне
});
ipcMain.on("tts:stopAll", () => {
  tts.stopAll();
  broadcast("sp:tts-stop", null);
});
ipcMain.handle("tts:voices", () => tts.voices());

ipcMain.handle("overlay:get", () => settings.overlay);
ipcMain.on("overlay:set", (_e, cfg) => {
  const wasEnabled = settings.overlay.enabled;
  settings.overlay = { ...settings.overlay, ...cfg };
  persist();
  if (settings.overlay.enabled !== wasEnabled) toggleOverlay(settings.overlay.enabled);
  else applyOverlayFlags();
});

ipcMain.on("app:quit", () => {
  app.isQuitting = true;
  app.quit();
});

/* ---------------- запуск ---------------- */

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  try { flushSettings(); } catch { /* noop */ }
  try { if (connectors) connectors.stopAll(); } catch { /* noop */ }
  try { if (bot) bot.stopAll(); } catch { /* noop */ }
  try { if (widgetServer) widgetServer.close(); } catch { /* noop */ }
  try { tts.dispose(); } catch { /* noop */ }
  try { disposeEdge(); } catch { /* noop */ }
  try { closeNet(); } catch { /* noop */ }
});

// окно может быть скрыто в трей — приложение не должно завершаться
app.on("window-all-closed", (e) => {
  if (!app.isQuitting) e.preventDefault();
});

app.whenReady().then(async () => {
  // Окно создаётся ПЕРВЫМ: интерфейс появляется сразу, а сервер виджета и
  // коннекторы поднимаются параллельно — иначе старт «залипал» на несколько секунд.
  // Кастомная схема yawachat:// — чтобы браузер мог вернуть фокус в приложение.
  /* Порядок старта важен для портативной сборки: раньше до создания окна
     успевали отработать регистрация протокола, перешифровка настроек, локальный
     сервер, восемь глобальных хоткеев и трей — окно появлялось через несколько
     секунд. Теперь первым делом создаём окно, остальное уходит в фон. */
  createMainWindow();

  // Всё, что не нужно для показа интерфейса, — после первой отрисовки.
  let deferredDone = false;
  const deferred = () => {
    if (deferredDone) return; // страховочный таймер не должен повторить работу
    deferredDone = true;
    try { app.setAsDefaultProtocolClient("yawachat"); } catch { /* noop */ }
    // Мастер-ключ шифрования заворачиваем в хранилище ОС (DPAPI/Keychain).
    // Перезапись контейнера нужна только если ключ ещё не защищён.
    try {
      secure.setSafeStorage(safeStorage);
    } catch { /* noop */ }
    try { startOAuthServer(); } catch { /* noop */ }
    try { registerHotkeys(); } catch { /* noop */ }
    try { createTray(); } catch { /* noop */ }
    // Соединение с Edge греем последним: к первой фразе оно всё равно готово.
    setTimeout(() => { try { warmupEdge(); } catch { /* noop */ } }, 1200);
  };
  if (mainWin) mainWin.webContents.once("did-finish-load", () => setTimeout(deferred, 60));
  else deferred();
  setTimeout(deferred, 2500); // подстраховка, если окно не отрисовалось

  widgetServer = await startWidgetServer({
    port: settings.port,
    token: settings.token,
    onClient: (n) => broadcast("sp:widget-clients", n),
    // Статус воспроизведения из браузерного источника: приложение показывает
    // подсказку, если OBS заблокировал автовоспроизведение или не нашёл голос.
    onStatus: (msg) => broadcast("sp:obs-tts", msg),
    onPort: (p) => {
      if (p && p !== settings.port) {
        settings.port = p;
        persist();
      }
    },
    onWarn: (msg) => console.warn("[widget]", msg),
  });

  // очередь событий до готовности окна — иначе первые статусы/сообщения теряются
  let rendererReady = false;
  const pending = [];
  const emit = (channel, payload) => {
    if (mainWin && !mainWin.isDestroyed() && rendererReady) broadcast(channel, payload);
    else pending.push([channel, payload]);
  };

  /**
   * Единая точка рассылки списка каналов — в окно приложения И в OBS-виджет.
   * Виджету список нужен, чтобы подгрузить смайлы BTTV/7TV/FFZ (Twitch) и Kick
   * КОНКРЕТНО этих каналов (иначе кастомные смайлы канала не показывались
   * в OBS, хотя в приложении и в оверлее уже отображались).
   */
  const broadcastChannels = (list) => {
    const merged = mergeDonationChannel(list);
    emit("sp:channels", merged);
    try { if (widgetServer && widgetServer.sendChannels) widgetServer.sendChannels(merged); } catch { /* noop */ }
  };

  connectors = new ConnectorManager({
    settings,
    onChat: (m) => {
      emit("sp:chat", m);
      // FIX(3.1.2): реальная лента в OBS-виджет — раньше улетали только тестовые сообщения
      try {
        if (widgetServer && widgetServer.broadcast) widgetServer.broadcast(m);
      } catch {}
    },
    onStatus: (list) => broadcastChannels(list),
  });

  /* ============================================================
     ЧАТ-БОТ: Twitch + VK, команды, модерация, DonationAlerts.
     Использует тот же settings.bot и шлёт сообщения в ту же ленту,
     что и коннекторы (sp:chat). Данные регистрации — из app-config.js.
     ============================================================ */
  const emitChannels = () => broadcastChannels(connectors ? connectors.list() : []);

  bot = new BotManager({
    settings,
    onChat: (m) => {
      emit("sp:chat", m);
      try { if (widgetServer && widgetServer.broadcast) widgetServer.broadcast(m); } catch { /* noop */ }
    },
    onBotStatus: (list) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:bot-status", list);
    },
    onChannels: emitChannels,
    onToken: (info) => {
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("sp:oauth-token", info);
    },
    // Авторизация сразу добавляет канал в «Каналы» (или перебивает прежний для этой площадки),
    // чтобы он сразу был виден в списке каналов с онлайном и зрителями.
    // Дубли сообщений гасятся в connectors.js (_isAuthManaged): чат идёт только от бота.
    onAuthorizedChannel: (platform, channelId) => {
      if (!connectors || (platform !== "twitch" && platform !== "vk")) return;
      const norm = (s) => String(s || "").trim().toLowerCase().replace(/^[@#]/, "");
      const target = norm(channelId);
      for (const c of connectors.list()) {
        if (c.platform === platform && norm(c.channelId) !== target) {
          connectors.remove(platform, c.channelId);
        }
      }
      connectors.add(platform, channelId);
    },
    onChannelRevoked: (platform, channelId) => {
      if (connectors && (platform === "twitch" || platform === "vk")) connectors.remove(platform, channelId);
    },
  });
  bot.setCommands("twitch", (settings.bot && settings.bot.commands && settings.bot.commands.twitch) || []);
  bot.setCommands("vk", (settings.bot && settings.bot.commands && settings.bot.commands.vk) || []);
  if (settings.bot && settings.bot.donationAlerts && settings.bot.donationAlerts.token) {
    bot.startDonationAlerts();
  }
  const startConnectors = () => {
    if (rendererReady) return;
    rendererReady = true;
    for (const [ch, p] of pending) broadcast(ch, p);
    pending.length = 0;
    connectors.startAll();
  // Бот: восстанавливаем команды и запускаем вебхук DonationAlerts, если был включён.
  bot.startAll();
  };
  if (mainWin) {
    mainWin.webContents.once("did-finish-load", () => setTimeout(startConnectors, 150));
    // подстраховка, если событие не пришло
    setTimeout(startConnectors, 3000);
  } else {
    startConnectors();
  }

  app.on("activate", () => {
    if (mainWin && !mainWin.isDestroyed()) mainWin.show();
  });
});
