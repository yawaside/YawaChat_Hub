// Мост между системным процессом и интерфейсом (contextIsolation включён).
const { contextBridge, ipcRenderer } = require("electron");

const mode = location.hash.includes("overlay") ? "overlay" : "app";

contextBridge.exposeInMainWorld("sp", {
  mode,
  platform: process.platform,

  /* чат и каналы */
  onChat: (cb) => ipcRenderer.on("sp:chat", (_e, m) => cb(m)),
  onChannels: (cb) => ipcRenderer.on("sp:channels", (_e, list) => cb(list)),
  getChannels: () => ipcRenderer.invoke("channels:list"),
  addChannel: (platform, channelId) => ipcRenderer.send("channels:add", { platform, channelId }),
  removeChannel: (platform, channelId) => ipcRenderer.send("channels:remove", { platform, channelId }),
  diagnoseNet: () => ipcRenderer.send("net:diagnose"),

  /* виджет OBS */
  widgetUrl: () => ipcRenderer.invoke("widget:url"),
  widgetInfo: () => ipcRenderer.invoke("widget:info"),
  widgetTest: (msg) => ipcRenderer.send("widget:test", msg),
  widgetConfig: (payload) => ipcRenderer.send("widget:config", payload),
  onWidgetClients: (cb) => ipcRenderer.on("sp:widget-clients", (_e, n) => cb(n)),
  /* Статус озвучки в OBS: played | blocked | no-voice | no-client | error.
     Позволяет показать причину, если звук в Browser Source не слышно. */
  onObsTts: (cb) => ipcRenderer.on("sp:obs-tts", (_e, msg) => cb(msg)),

  /* настройки (settings.json рядом с exe) — сохраняются сразу, без кнопки */
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    patch: (patch) => ipcRenderer.send("settings:patch", patch),
    onChange: (cb) => ipcRenderer.on("sp:settings", (_e, s) => cb(s)),
  },

  /* глобальные горячие клавиши */
  onHotkey: (cb) => ipcRenderer.on("sp:hotkey", (_e, action) => cb(action)),
  hotkeys: {
    apply: (map) => ipcRenderer.send("hotkeys:apply", map),
    /* Сочетания, занятые другой программой — показываем их в настройках. */
    conflicts: () => ipcRenderer.invoke("hotkeys:conflicts"),
    onConflicts: (cb) => ipcRenderer.on("sp:hotkey-conflicts", (_e, list) => cb(list)),
  },

  /* окно: свернуть / скрыть в трей / во весь экран / закрыть */
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    hideToTray: () => ipcRenderer.send("window:hide-to-tray"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    onMaximize: (cb) => ipcRenderer.on("sp:maximize", (_e, v) => cb(v)),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  },

  /* SAPI озвучка */
  tts: {
    speak: ({ text, rate, volume, voice }) => {
      const id = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
      ipcRenderer.send("tts:speak", { id, text, rate, volume, voice });
      return id;
    },
    skip: () => ipcRenderer.send("tts:skip"),
    stopAll: () => ipcRenderer.send("tts:stopAll"),
    voices: () => ipcRenderer.invoke("tts:voices"),
    onEnd: (cb) => ipcRenderer.on("sp:tts-end", (_e, id) => cb(id)),
    /* Edge TTS: главный процесс синтезирует MP3, окно его проигрывает.
       Так не нужен внешний плеер на PowerShell — меньше задержка и нагрузка. */
    onAudio: (cb) => ipcRenderer.on("sp:tts-audio", (_e, payload) => cb(payload)),
    onStop: (cb) => ipcRenderer.on("sp:tts-stop", () => cb()),
    audioDone: (id) => ipcRenderer.send("tts:audio-done", id),
  },

  /* игровой оверлей */
  overlay: {
    get: () => ipcRenderer.invoke("overlay:get"),
    set: (cfg) => ipcRenderer.send("overlay:set", cfg),
    onChange: (cb) => ipcRenderer.on("sp:overlay", (_e, o) => cb(o)),
  },


  /* ---------------- чат-бот: команды, модерация, DonationAlerts ---------------- */
  bot: {
    status: () => ipcRenderer.invoke("bot:status"),
    save: (patch) => ipcRenderer.invoke("bot:save", patch),
    connect: (platform) => ipcRenderer.send("bot:connect", platform),
    disconnect: (platform) => ipcRenderer.send("bot:disconnect", platform),
    commands: (platform) => ipcRenderer.invoke("bot:commands", platform),
    addCommand: (platform, command) => ipcRenderer.invoke("bot:command:add", { platform, command }),
    removeCommand: (platform, id) => ipcRenderer.send("bot:command:remove", { platform, id }),
    send: (platform, channel, text) => ipcRenderer.invoke("bot:send", { platform, channel, text }),
    moderate: (payload) => ipcRenderer.invoke("bot:moderate", payload),
    timeouts: (platform) => ipcRenderer.invoke("bot:timeouts", platform),
    donation: () => ipcRenderer.invoke("bot:donation"),
    setDonationCurrency: (currency) => ipcRenderer.send("bot:donation:currency", currency),
    daReset: () => ipcRenderer.send("bot:donation:reset"),
    onStatus: (cb) => {
      ipcRenderer.on("sp:bot-status", (_e, list) => cb(list));
      return () => ipcRenderer.removeAllListeners("sp:bot-status");
    },
    onDonate: (cb) => {
      ipcRenderer.on("sp:donation", (_e, d) => cb(d));
      return () => ipcRenderer.removeAllListeners("sp:donation");
    },
  },

  /* Авторизация по площадкам: открывается браузер по умолчанию,
     токен возвращается через сайт и локальный мост. */
  oauth: {
    twitch: () => ipcRenderer.invoke("oauth:start", "twitch"),
    vk: () => ipcRenderer.invoke("oauth:start", "vk"),
    submit: (platform, token) => ipcRenderer.invoke("oauth:submit", { platform, token }),
    state: () => ipcRenderer.invoke("oauth:state"),
    revoke: (platform) => ipcRenderer.invoke("oauth:revoke", platform),
    onToken: (cb) => {
      ipcRenderer.on("sp:oauth-token", (_e, info) => cb(info));
      return () => ipcRenderer.removeAllListeners("sp:oauth-token");
    },
  },

  /* полный выход (минуя трей) */
  app: {
    quit: () => ipcRenderer.send("app:quit"),
  },
});
