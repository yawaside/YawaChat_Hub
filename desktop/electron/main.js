// YawaChatHub — главный процесс Electron.
// Окна: главное (приложение целиком) + игровой оверлей (always-on-top, click-through, drag).
// Системный трей, глобальные горячие клавиши, локальный сервер виджета, SAPI TTS.
//
// FIX(2.0.0): «Сворачивать в трей при закрытии» — рабочая настройка.
//   Раньше переключатель в интерфейсе был заглушкой: он всегда показывал «включено»
//   и только выводил тост про settings.json. Теперь closeToTray читается из
//   settings.json при каждом закрытии окна, меняется из интерфейса (settings:patch)
//   и из меню трея, а крестик честно завершает приложение, когда настройка выключена.
// TLS. На машинах с антивирусом или корпоративным прокси стоит TLS-инспекция:
// Chromium доверяет её корневому сертификату, а «сырой» Node — нет, и соединения
// с Twitch/Kick/VK/TikTok падали с "unable to verify the first certificate".
//
// Раньше здесь стояло NODE_TLS_REJECT_UNAUTHORIZED = "0" — это отключало проверку
// сертификатов ВО ВСЁМ процессе, включая обновления и любые сторонние модули.
// Так делать нельзя: это дыра в безопасности и конфликт с политиками компаний.
// Теперь проверку ослабляем точечно — только для наших чат-хостов и только если
// системное хранилище действительно не смогло проверить цепочку (см. net.js и
// app.on("certificate-error") ниже).

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell } = require("electron");
const path = require("path");
const { getBaseDir, loadSettings, saveSettings } = require("./settings");
const { startWidgetServer } = require("./widgetServer");
const { ConnectorManager } = require("./connectors");
const { TtsEngine } = require("./tts");
const { warmupEdge, disposeEdge } = require("./edgeTts");
const { closeNet, installCertificateHandler } = require("./net");

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
// Ограничиваем кучу V8 в главном процессе: ему хватает 128 МБ, а сборщик
// начинает работать раньше и не даёт памяти расползаться за сутки стрима.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=128");
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
const tts = new TtsEngine();

// Вторая копия не поднимает второй сервер виджета и второй набор коннекторов —
// иначе занят порт, дублируются сообщения и конфликтуют горячие клавиши.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Пользователь запустил ярлык ещё раз — показываем уже открытое окно.
    if (!mainWin || mainWin.isDestroyed()) return;
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
  });
}

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
  broadcast("sp:settings", settings);
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

/* ---------------- IPC ---------------- */

ipcMain.on("channels:add", (_e, c) => connectors && connectors.add(c.platform, c.channelId));
ipcMain.on("channels:remove", (_e, c) => connectors && connectors.remove(c.platform, c.channelId));
ipcMain.handle("channels:list", () => (connectors ? connectors.list() : []));
ipcMain.on("net:diagnose", () => connectors && connectors.diagnose());

ipcMain.handle("widget:url", () => (widgetServer ? widgetServer.url : ""));
ipcMain.handle("widget:info", () => ({
  port: (widgetServer && widgetServer.port) || settings.port,
  token: settings.token,
  url: widgetServer ? widgetServer.url : "",
}));
// тестовое сообщение из панели виджета — летит во все подключённые OBS-клиенты
ipcMain.on("widget:test", (_e, msg) => {
  if (widgetServer && msg && msg.text) widgetServer.broadcast(msg);
});

// Оформление виджета: применяется в OBS мгновенно, ссылка при этом не меняется.
// Озвучка идёт ОТДЕЛЬНЫМ каналом sendTts, поэтому не портит сохранённое оформление.
ipcMain.on("widget:config", (_e, payload) => {
  if (!widgetServer) return;

  if (payload && payload.ttsPlay) {
    const request = payload.ttsPlay;
    if (!widgetServer.clientCount || widgetServer.clientCount() === 0) {
      // OBS не подключён — синтезировать нечего и незачем.
      broadcast("sp:obs-tts", { id: request.id, state: "no-client" });
      return;
    }
    tts
      .synthesizeWavBase64(request)
      .then((res) => {
        if (res && res.audioBase64) {
          // volume передаём отдельно: у Edge громкость не пишется в SSML,
          // её применяет <audio> — так один синтез годится для любой громкости.
          widgetServer.sendTts({
            ttsAudio: {
              id: request.id,
              audioBase64: res.audioBase64,
              mime: res.mime || "audio/wav",
              volume: request.volume,
            },
          });
        } else {
          // Синтез недоступен — просим виджет озвучить своими силами.
          widgetServer.sendTts({ ttsPlay: request });
        }
      })
      .catch((err) => {
        console.warn("[obs-tts] синтез не удался:", err && err.message);
        widgetServer.sendTts({ ttsPlay: request });
      });
    return;
  }

  // Полезная нагрузка вроде { tts: {...} } — это НЕ оформление виджета.
  // Раньше она сохранялась как последний конфиг и ломала вид у новых клиентов.
  if (payload && (payload.cfg || payload.look)) widgetServer.sendConfig(payload);
});

ipcMain.handle("settings:get", () => settings);
ipcMain.on("settings:patch", (_e, patch) => {
  Object.assign(settings, patch);
  persist();
  refreshTrayMenu();
  broadcast("sp:settings", settings);
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
  try { if (connectors) connectors.stopAll(); } catch { /* noop */ }
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
  registerHotkeys();
  createMainWindow();
  createTray();
  // Открываем соединение с Edge заранее: первая фраза не ждёт TLS-рукопожатия.
  warmupEdge();

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

  connectors = new ConnectorManager({
    settings,
    onChat: (m) => {
      emit("sp:chat", m);
      // FIX(3.1.2): реальная лента в OBS-виджет — раньше улетали только тестовые сообщения
      try {
        if (widgetServer && widgetServer.broadcast) widgetServer.broadcast(m);
      } catch {}
    },
    onStatus: (list) => emit("sp:channels", list),
  });

  // коннекторы стартуют только после того, как интерфейс готов принимать события
  const startConnectors = () => {
    if (rendererReady) return;
    rendererReady = true;
    for (const [ch, p] of pending) broadcast(ch, p);
    pending.length = 0;
    connectors.startAll();
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
