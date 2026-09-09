// Мост между системным процессом и интерфейсом (contextIsolation включён).
const { contextBridge, ipcRenderer } = require("electron");

const mode = location.hash.includes("overlay") ? "overlay" : "app";

/**
 * Подписка на событие главного процесса с функцией отписки.
 * Раньше слушатели навешивались без снятия (и снимались через removeAllListeners,
 * что обрывало чужие подписки) — при перемонтировании панелей React слушатели
 * копились и каждое сообщение чата обрабатывалось несколько раз: рост памяти и CPU.
 */
function sub(channel, cb, map = (...args) => args[0]) {
  const handler = (_e, ...args) => cb(map(...args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("sp", {
  mode,
  platform: process.platform,

  /* чат и каналы */
  onChat: (cb) => sub("sp:chat", cb),
  onChannels: (cb) => sub("sp:channels", cb),
  getChannels: () => ipcRenderer.invoke("channels:list"),
  addChannel: (platform, channelId) => ipcRenderer.send("channels:add", { platform, channelId }),
  removeChannel: (platform, channelId) => ipcRenderer.send("channels:remove", { platform, channelId }),
  diagnoseNet: () => ipcRenderer.send("net:diagnose"),

  /* виджет OBS */
  widgetUrl: () => ipcRenderer.invoke("widget:url"),
  widgetInfo: () => ipcRenderer.invoke("widget:info"),
  widgetTest: (msg) => ipcRenderer.send("widget:test", msg),
  widgetConfig: (payload) => ipcRenderer.send("widget:config", payload),
  onWidgetClients: (cb) => sub("sp:widget-clients", cb),
  /* Статус озвучки в OBS: played | blocked | no-voice | no-client | error.
     Позволяет показать причину, если звук в Browser Source не слышно. */
  onObsTts: (cb) => sub("sp:obs-tts", cb),

  /* настройки (settings.dat рядом с exe, зашифрованный контейнер) — сохраняются сразу */
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    patch: (patch) => ipcRenderer.send("settings:patch", patch),
    onChange: (cb) => sub("sp:settings", cb),
  },

  /* глобальные горячие клавиши */
  onHotkey: (cb) => sub("sp:hotkey", cb),
  hotkeys: {
    apply: (map) => ipcRenderer.send("hotkeys:apply", map),
    /* Сочетания, занятые другой программой — показываем их в настройках. */
    conflicts: () => ipcRenderer.invoke("hotkeys:conflicts"),
    onConflicts: (cb) => sub("sp:hotkey-conflicts", cb),
  },

  /* окно: свернуть / скрыть в трей / во весь экран / закрыть */
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    hideToTray: () => ipcRenderer.send("window:hide-to-tray"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    onMaximize: (cb) => sub("sp:maximize", cb),
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
    onEnd: (cb) => sub("sp:tts-end", cb),
    /* Edge TTS: главный процесс синтезирует MP3, окно его проигрывает.
       Так не нужен внешний плеер на PowerShell — меньше задержка и нагрузка. */
    onAudio: (cb) => sub("sp:tts-audio", cb),
    onStop: (cb) => sub("sp:tts-stop", cb),
    audioDone: (id) => ipcRenderer.send("tts:audio-done", id),
  },

  /* игровой оверлей */
  overlay: {
    get: () => ipcRenderer.invoke("overlay:get"),
    set: (cfg) => ipcRenderer.send("overlay:set", cfg),
    onChange: (cb) => sub("sp:overlay", cb),
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
    onStatus: (cb) => sub("sp:bot-status", cb),
    onDonate: (cb) => sub("sp:donation", cb),
  },

  /* Авторизация по площадкам: открывается браузер по умолчанию,
     токен возвращается через сайт и локальный мост. */
  oauth: {
    twitch: () => ipcRenderer.invoke("oauth:start", "twitch"),
    vk: () => ipcRenderer.invoke("oauth:start", "vk"),
    submit: (platform, token) => ipcRenderer.invoke("oauth:submit", { platform, token }),
    state: () => ipcRenderer.invoke("oauth:state"),
    revoke: (platform) => ipcRenderer.invoke("oauth:revoke", platform),
    onToken: (cb) => sub("sp:oauth-token", cb),
    /* Ошибка входа (например, VK не выдал токен) — сайт видит только «opaque»-ответ,
       поэтому причину показывает само приложение. */
    onError: (cb) => sub("sp:oauth-error", cb),
  },

  /* полный выход (минуя трей) */
  app: {
    quit: () => ipcRenderer.send("app:quit"),
  },
});
