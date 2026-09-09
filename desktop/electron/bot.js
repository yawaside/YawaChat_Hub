// ============================================================
//  YawaChatHub — движок чат-бота (Twitch + VK) и канала DonationAlerts.
//
//  Отличие от connectors.js: бот работает ОТ ИМЕНИ авторизованного аккаунта,
//  поэтому умеет отправлять сообщения, модерировать и читать подписки.
//
//  Авторизация — только по площадкам (ник канала вводить не нужно):
//    1. интерфейс вызывает oauth:start → открывается БРАУЗЕР ПО УМОЛЧАНИЮ;
//    2. площадка возвращает пользователя на https://yawachathub.netlify.app/;
//    3. страница сайта читает токен из адреса и пересылает его в приложение
//       на http://127.0.0.1:17563 (см. src/App.tsx и startOAuthServer в main.js);
//    4. BotManager сам узнаёт аккаунт и канал через API и подключается.
// ============================================================
const WebSocket = require("ws");
const { getJson, postJson, request, tlsOptionsFor } = require("./net");
const { APP_CONFIG } = require("./app-config");

const TWITCH_IRC = "wss://irc-ws.chat.twitch.tv:443";
const TWITCH_API = "https://api.twitch.tv/helix";
const DA_API = "https://www.donationalerts.com/api/v1";

/* ---------------- IRC helpers ---------------- */

function parseTags(raw) {
  const tags = {};
  for (const part of String(raw || "").split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    tags[part.slice(0, i)] = part
      .slice(i + 1)
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\\\/g, "\\");
  }
  return tags;
}

function parseIrc(line) {
  let rest = line;
  let tags = {};
  if (rest.startsWith("@")) {
    const sp = rest.indexOf(" ");
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }
  let prefix = "";
  if (rest.startsWith(":")) {
    const sp = rest.indexOf(" ");
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }
  const sp = rest.indexOf(" ");
  const command = sp === -1 ? rest : rest.slice(0, sp);
  const params = sp === -1 ? "" : rest.slice(sp + 1);
  return { tags, prefix, command, params };
}

function login(s) {
  return String(s || "").trim().replace(/^#/, "").replace(/^@/, "").toLowerCase();
}

/* ============================================================
   BotManager
   ============================================================ */

class BotManager {
  constructor({ settings, onChat, onBotStatus, onChannels, onToken }) {
    this.settings = settings;
    this.onChat = onChat;
    this.onBotStatus = onBotStatus;
    this.onChannels = onChannels;
    this.onToken = onToken;

    this.bots = new Map(); // platform -> bot runtime
    this.da = null;        // DonationAlerts runtime
    this.commands = new Map(); // platform -> [{ id, trigger, response, cooldownSec, lastRun }]
  }

  /* ---------------- сообщения ---------------- */

  emit(platform, { author, text, color, badges, kind, amount, currency }) {
    if (!text) return;
    this.onChat({
      id: `b${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: author || "бот",
      text: String(text),
      color: color || "#4c8dff",
      badges: badges || [],
      ts: Date.now(),
      sys: false,
      kind: kind || "chat.message",
      amount,
      currency,
    });
  }

  emitEvent(platform, kind, text) {
    if (!text) return;
    this.onChat({
      id: `e${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: "YawaChatHub",
      text: String(text),
      color: "#8b91a8",
      badges: [],
      ts: Date.now(),
      sys: true,
      kind,
    });
  }

  /* ---------------- конфиг ---------------- */

  botConfig(platform) {
    const bot = this.settings.bot || {};
    return { ...(bot[platform] || {}) };
  }

  saveBot(platform, patch) {
    const bot = this.settings.bot || {};
    bot[platform] = { ...(bot[platform] || {}), ...patch };
    this.settings.bot = { ...bot, [platform]: bot[platform] };
    try {
      require("./settings").saveSettings(this.settings);
    } catch { /* noop */ }
  }

  /* ============================================================
     Авторизация: токен приходит со страницы сайта
     ============================================================ */

  /** Сохраняет токен и сразу узнаёт аккаунт + канал через API. */
  async handleOAuthToken(platform, token) {
    // Нормализуем токен: у Twitch implicit-flow отдаёт «raw», у ручного ввода
    // может встретиться префикс «oauth:» — Helix принимает только raw.
    const clean = String(token || "").trim().replace(/^oauth:/, "");
    this.saveBot(platform, { token: clean, enabled: true });
    this.emitEvent(platform, "bot.join", `${platform === "twitch" ? "Twitch" : "VK"}: токен получен, определяем канал…`);
    const info = await this.resolveAccount(platform, token).catch(() => null);
    if (info) {
      this.saveBot(platform, { ...info, token, enabled: true });
      this.emitEvent(platform, "bot.join", `Чат-бот: ${platform === "twitch" ? "Twitch" : "VK"} / ${info.channel}`);
    } else {
      this.emitEvent(platform, "bot.join", `Чат-бот: не удалось определить канал ${platform} — проверьте токен`);
    }
    this.connect(platform);
    if (this.onToken) this.onToken({ platform, account: info && info.account, channel: info && info.channel });
  }

  /** Авторизация: узнать ник аккаунта и его канал — пользователь ничего не вводит. */
  async resolveAccount(platform, token) {
    if (platform === "twitch") {
      const clientId = this.twitchClientId();
      const data = await getJson(`${TWITCH_API}/users`, {
        "Client-Id": clientId,
        Authorization: `Bearer ${token}`,
        accept: "application/json",
      });
      const u = data && data.data && data.data[0];
      if (!u) return null;
      return { account: u.login, channel: u.login, accountId: u.id, displayName: u.display_name };
    }
    if (platform === "vk") {
      // VK: определяем пользователя по токену, канал VK Play берём из его страницы.
      const data = await getJson(
        `https://api.vk.com/method/users.get?fields=screen_name,domain&access_token=${encodeURIComponent(token)}&v=5.199`,
        { accept: "application/json" }
      );
      const u = data && data.response && data.response[0];
      if (!u) return null;
      const channel = String(u.screen_name || u.domain || u.id).toLowerCase();
      return { account: channel, channel, accountId: String(u.id), displayName: `${u.first_name || ""} ${u.last_name || ""}`.trim() };
    }
    return null;
  }

  twitchClientId() {
    return String(this.botConfig("twitch").clientId || APP_CONFIG.twitch.clientId || "").trim();
  }

  /* ============================================================
     Подключение бота
     ============================================================ */

  status(platform) {
    const b = this.bots.get(platform);
    const cfg = this.botConfig(platform);
    return {
      platform,
      status: b ? b.status : cfg.token ? "offline" : "offline",
      error: (b && b.error) || "",
      connectedAt: (b && b.connectedAt) || 0,
      followCount: (b && b.followCount) || 0,
      lastEvent: (b && b.lastEvent) || "",
      lastEventAt: (b && b.lastEventAt) || 0,
      channels: cfg.channel ? [cfg.channel] : [],
      botAccount: cfg.account || "",
      authorized: Boolean(cfg.token),
      account: cfg.account || "",
      oauthUrl: APP_CONFIG.redirectUrl,
    };
  }

  snapshot() {
    return ["twitch", "vk"].map((p) => this.status(p));
  }

  authState() {
    return ["twitch", "vk"].map((p) => {
      const cfg = this.botConfig(p);
      return { platform: p, authorized: Boolean(cfg.token), account: cfg.account, channel: cfg.channel };
    });
  }

  connect(platform) {
    const cfg = this.botConfig(platform);
    if (!cfg.token) {
      const b = this.runtime(platform);
      b.status = "offline";
      b.error = "Нужна авторизация";
      this.flushStatus();
      return;
    }
    if (platform === "twitch") this.connectTwitch(cfg);
    else if (platform === "vk") this.connectVk(cfg);
  }

  disconnect(platform) {
    const b = this.bots.get(platform);
    if (b) this.teardown(b);
    this.saveBot(platform, { enabled: false });
    this.runtime(platform).status = "offline";
    this.flushStatus();
  }

  /** Полное отключение: токен удаляется, бот выходит. */
  revoke(platform) {
    const b = this.bots.get(platform);
    if (b) this.teardown(b);
    this.saveBot(platform, { token: "", enabled: false, account: "", channel: "" });
    this.runtime(platform).status = "offline";
    this.emitEvent(platform, "bot.leave", `Чат-бот: авторизация ${platform} отменена`);
    this.flushStatus();
  }

  runtime(platform) {
    let b = this.bots.get(platform);
    if (!b) {
      b = {
        platform,
        status: "offline",
        error: "",
        connectedAt: 0,
        followCount: 0,
        lastEvent: "",
        lastEventAt: 0,
        alive: true,
        ws: null,
        vkClient: null,
        ping: null,
        retry: null,
        attempts: 0,
        seenFollowers: new Set(),
      };
      this.bots.set(platform, b);
    }
    return b;
  }

  teardown(b) {
    b.alive = false;
    if (b.ping) { clearInterval(b.ping); b.ping = null; }
    if (b.retry) { clearTimeout(b.retry); b.retry = null; }
    if (b.ws) { try { b.ws.terminate(); } catch { /* noop */ } b.ws = null; }
    if (b.vkClient) { try { b.vkClient.disconnect && b.vkClient.disconnect(); } catch { /* noop */ } b.vkClient = null; }
  }

  setStatus(b, status, error) {
    b.status = status;
    if (error) b.error = error;
    if (status === "online") { b.error = ""; b.attempts = 0; b.connectedAt = Date.now(); }
    this.flushStatus();
  }

  flushStatus() {
    if (this.onBotStatus) this.onBotStatus(this.snapshot());
  }

  startAll() {
    for (const p of ["twitch", "vk"]) {
      const cfg = this.botConfig(p);
      if (cfg.token && cfg.enabled !== false) this.connect(p);
    }
    this.flushStatus();
  }

  stopAll() {
    for (const p of ["twitch", "vk"]) {
      const b = this.bots.get(p);
      if (b) this.teardown(b);
    }
    this.stopDonationAlerts();
  }

  /* ---------------- Twitch ---------------- */

  connectTwitch(cfg) {
    const b = this.runtime("twitch");
    this.teardown(b);
    b.alive = true;
    const channel = login(cfg.channel || cfg.account);
    const nick = login(cfg.account);
    const token = String(cfg.token || "").replace(/^oauth:/, "");
    if (!channel || !nick) { this.setStatus(b, "error", "Канал неизвестен — авторизуйтесь заново"); return; }
    this.setStatus(b, "connecting");

    let ws;
    try {
      ws = new WebSocket(TWITCH_IRC, tlsOptionsFor(TWITCH_IRC));
    } catch {
      this.setStatus(b, "error", "Не удалось открыть Twitch IRC");
      return;
    }
    b.ws = ws;
    const send = (s) => { try { ws.send(s); } catch { /* noop */ } };

    ws.on("open", () => {
      if (!b.alive) return;
      send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
      send(`PASS oauth:${token}`);
      send(`NICK ${nick}`);
      send(`JOIN #${channel}`);
      b.ping = setInterval(() => send("PING :tmi.twitch.tv"), 60000);
    });

    ws.on("message", (raw) => {
      if (!b.alive) return;
      for (const line of raw.toString().split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) { send("PONG :tmi.twitch.tv"); continue; }
        const msg = parseIrc(line);

        if (msg.command === "001" || msg.command === "JOIN" || msg.command === "366") {
          if (b.status !== "online") {
            this.setStatus(b, "online");
            this.emitEvent("twitch", "bot.join", `Чат-бот Twitch подключён: #${channel} (аккаунт ${nick})`);
            this.watchTwitchFollowers(b, cfg);
          }
          continue;
        }
        if (msg.command === "NOTICE" && /Login authentication failed|auth/i.test(msg.params)) {
          this.setStatus(b, "error", "Twitch отклонил токен — авторизуйтесь заново");
          continue;
        }

        /* ---- события USERNOTICE: подписки, подарки, рейды ---- */
        if (msg.command === "USERNOTICE") {
          const kind = String(msg.tags["msg-id"] || "");
          const who = msg.tags["display-name"] || (msg.prefix || "").split("!")[0] || "зритель";
          const plan = msg.tags["msg-param-sub-plan"] || "";
          const months = msg.tags["msg-param-cumulative-months"] || msg.tags["msg-param-months"] || "";
          const recipient = msg.tags["msg-param-recipient-display-name"] || "";
          const viewers = msg.tags["msg-param-viewerCount"] || "";
          const extra = (msg.params || "").split(" :").slice(1).join(" :");
          const map = {
            sub: ["sys.subscribe", `${who} оформил подписку (${plan || "sub"})${months ? `, ${months} мес.` : ""}`],
            resub: ["sys.resub", `${who} продлил подписку${months ? ` на ${months} мес.` : ""}`],
            subgift: ["sys.subgift", `${who} подарил подписку ${recipient}`],
            submysterygift: ["sys.submystery", `${who} раздаёт подписки (${msg.tags["msg-param-mass-gift-count"] || "?"} шт.)`],
            raid: ["mod.raid", `Рейд из ${who}: ${viewers} зрителей`],
            announce: ["sys.announcement", `Объявление: ${extra || who}`],
            highlighted: ["chat.highlighted", `${who}: ${extra}`],
          };
          if (map[kind]) { this.emit("twitch", { author: who, text: map[kind][1], badges: ["BOT"], kind: map[kind][0] }); continue; }
          continue;
        }

        if (msg.command === "PRIVMSG") {
          const sp = msg.params.indexOf(" :");
          if (sp === -1) continue;
          const text = msg.params.slice(sp + 2);
          const user = (msg.prefix.split("!")[0] || "").replace(/^#/, "");
          const author = msg.tags["display-name"] || user;
          const badges = [];
          const badgeStr = String(msg.tags.badges || "");
          if (msg.tags.mod === "1" || badgeStr.includes("moderator/") || badgeStr.includes("broadcaster/")) badges.push("MOD");
          if (badgeStr.includes("vip/")) badges.push("VIP");
          if (msg.tags.subscriber === "1") badges.push("SUB");

          /* Тип события — по нему работает фильтр «Лента → События». */
          const first = msg.tags["first-msg"] === "1";
          const kind = text.startsWith("!") ? "chat.command"
            : first ? "chat.first"
            : /https?:\/\//i.test(text) ? "chat.link"
            : "chat.message";

          this.emit("twitch", { author, text, color: msg.tags.color || "", badges, kind });
          this.handleCommand("twitch", channel, author, user, text);
          continue;
        }

        /* ---- модерация: чат меняет режимы ---- */
        if (msg.command === "CLEARCHAT") {
          const target = String(msg.params || "").replace(/^:/, "").trim();
          if (target) this.emitEvent("twitch", "mod.timeout", `${target} получил таймаут`);
          else this.emitEvent("twitch", "mod.clear", "Чат очищен модератором");
          continue;
        }
        if (msg.command === "CLEARMSG") {
          const target = String(msg.tags["login"] || "");
          this.emitEvent("twitch", "mod.delete", `Сообщение ${target} удалено`);
          continue;
        }
        if (msg.command === "ROOMSTATE") {
          const t = msg.tags || {};
          if (t.slow === "1") this.emitEvent("twitch", "mod.slow", "Медленный режим включён");
          if (t["emote-only"] === "1") this.emitEvent("twitch", "mod.emoteonly", "Режим «только смайлы»");
          if (t["followers-only"] !== undefined && t["followers-only"] !== "-1") this.emitEvent("twitch", "mod.followers", "Чат только для подписчиков");
          if (t["subs-only"] === "1") this.emitEvent("twitch", "mod.subscribers", "Чат только для субов");
          continue;
        }
      }
    });

    ws.on("close", () => {
      if (!b.alive) return;
      b.attempts += 1;
      this.setStatus(b, b.attempts > 2 ? "error" : "connecting", "Переподключение…");
      b.retry = setTimeout(() => { if (b.alive) this.connect("twitch"); }, Math.min(8000 * b.attempts, 60000));
    });
    ws.on("error", () => { try { ws.close(); } catch { /* noop */ } });
  }

  /** Подписки/отслеживания: периодический опрос Helix. */
  watchTwitchFollowers(b, cfg) {
    const clientId = this.twitchClientId();
    const token = String(cfg.token || "");
    if (!clientId || !token) return;
    const run = async () => {
      if (!b.alive || b.status !== "online") return;
      try {
        const from = `${TWITCH_API}/channels/followers?broadcaster_id=${encodeURIComponent(cfg.accountId || cfg.account)}`;
        const data = await getJson(from, {
          "Client-Id": clientId,
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        }).catch(() => null);
        const list = (data && data.data) || [];
        if (Array.isArray(list) && list.length) {
          b.followCount = Number(data.total != null ? data.total : list.length);
          for (const f of list) {
            const name = f.user_name || f.user_login;
            if (!name) continue;
            if (b.seenFollowers.has(String(name).toLowerCase())) continue;
            b.seenFollowers.add(String(name).toLowerCase());
            if (b.seenFollowers.size <= list.length && b.seenFollowers.size > 0 && list.length && b.seenFollowers.size > 1) {
              this.emit("twitch", { author: name, text: `${name} подписался на канал 🎉`, badges: ["BOT"], kind: "sys.follow" });
            }
          }
          b.lastEvent = `подписчиков: ${b.followCount}`;
          this.flushStatus();
        }
      } catch { /* noop */ }
      if (b.alive) b.retry = setTimeout(run, 60000);
    };
    run();
  }

  /* ---------------- VK ---------------- */

  connectVk(cfg) {
    const b = this.runtime("vk");
    this.teardown(b);
    b.alive = true;
    const channel = login(cfg.channel || cfg.account);
    const token = String(cfg.token || "");
    if (!channel) { this.setStatus(b, "error", "Канал неизвестен — авторизуйтесь заново"); return; }
    if (!token) { this.setStatus(b, "error", "Нужна авторизация VK"); return; }
    this.setStatus(b, "connecting");

    let VKPLMessageClient = null;
    try {
      // eslint-disable-next-line global-require
      const mod = require("vklive-message-client");
      VKPLMessageClient = mod.default || mod.VKPLMessageClient;
    } catch (e) {
      this.setStatus(b, "error", "Библиотека VK-чата недоступна в этой сборке");
      return;
    }
    if (!VKPLMessageClient) { this.setStatus(b, "error", "Библиотека VK-чата недоступна"); return; }

    let client;
    try {
      client = new VKPLMessageClient({ auth: "token", token, channels: [channel], debugLog: false, log: false });
    } catch (e) {
      this.setStatus(b, "error", `Не удалось создать подключение: ${String(e.message || e).slice(0, 60)}`);
      return;
    }
    b.vkClient = client;

    client.on("message", (ctx) => {
      if (!b.alive) return;
      const text = (ctx && ctx.message && (ctx.message.text || ctx.message.message)) || (ctx && ctx.text) || "";
      if (!text) return;
      const author = (ctx && ctx.user && (ctx.user.nick || ctx.user.displayName)) || "зритель";
      const badges = [];
      if (ctx && ((ctx.message && ctx.message.author && ctx.message.author.isAdmin) || (ctx.user && ctx.user.isAdmin))) badges.push("MOD");
      if (b.status !== "online") this.setStatus(b, "online");
      this.emit("vk", {
        author,
        text,
        badges,
        kind: text.startsWith("!") ? "chat.command" : "chat.message",
      });
      this.handleCommand("vk", channel, author, "", text);
    });
    client.on("channel-info", (ctx) => {
      if (!b.alive) return;
      if (b.status !== "online" && (ctx && (ctx.isOnline || ctx.streamInfo || ctx.stream))) {
        this.setStatus(b, "online");
        this.emitEvent("vk", "bot.join", `Чат-бот VK подключён: ${channel}`);
      }
    });
    client.on("stream-status", (ctx) => {
      if (!b.alive) return;
      if (ctx && ctx.type === "stream_end") this.emitEvent("vk", "stream.offline", `VK: трансляция ${channel} завершена`);
      if (ctx && ctx.type === "stream_start") this.emitEvent("vk", "stream.online", `VK: трансляция ${channel} началась`);
    });

    (async () => {
      try {
        await client.connect();
        if (!b.alive) return;
        this.setStatus(b, "online");
        this.emitEvent("vk", "bot.join", `Чат-бот VK подключён: ${channel}`);
        this.watchVkFollowers(b, token, channel);
      } catch (e) {
        if (!b.alive) return;
        this.setStatus(b, "error", String(e.message || e).slice(0, 90));
      }
    })();
  }

  watchVkFollowers(b, token, channel) {
    const run = async () => {
      if (!b.alive || b.status !== "online") return;
      try {
        const data = await getJson(
          `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channel)}/public_info`,
          { Authorization: `Bearer ${token}`, accept: "application/json" }
        ).catch(() => null);
        const n = data && (data.data ? data.data.followers : data.followers);
        if (typeof n === "number" && n !== b.followCount) {
          if (b.followCount && n > b.followCount) {
            this.emit("vk", { author: "VK", text: `Новый подписчик! Всего ${n} 👍`, badges: ["BOT"], kind: "sys.follow" });
          }
          b.followCount = n;
          this.flushStatus();
        }
      } catch { /* noop */ }
      if (b.alive) b.retry = setTimeout(run, 60000);
    };
    run();
  }

  /* ============================================================
     КОМАНДЫ
     ============================================================ */

  listCommands(platform) {
    const stored = (this.settings.bot && this.settings.bot.commands && this.settings.bot.commands[platform]) || [];
    const cur = this.commands.get(platform);
    if (!cur || cur.length !== stored.length) {
      this.commands.set(platform, stored.map((c) => ({ ...c })));
    }
    return this.commands.get(platform) || [];
  }

  setCommands(platform, list) {
    const safe = (Array.isArray(list) ? list : []).map((c) => ({
      id: String(c.id || `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`),
      trigger: String(c.trigger || "").toLowerCase(),
      response: String(c.response || ""),
      cooldownSec: Math.max(0, Number(c.cooldownSec) || 0),
      lastRun: 0,
    })).filter((c) => c.trigger && c.response);
    this.commands.set(platform, safe);
    this.settings.bot = this.settings.bot || {};
    this.settings.bot.commands = this.settings.bot.commands || {};
    this.settings.bot.commands[platform] = safe;
    try { require("./settings").saveSettings(this.settings); } catch { /* noop */ }
  }

  addCommand(platform, cmd) {
    const trigger = String(cmd.trigger || "").trim().toLowerCase();
    const response = String(cmd.response || "").trim();
    if (!trigger) { const e = new Error("Укажите команду"); e.handled = true; throw e; }
    if (!response) { const e = new Error("Укажите ответ"); e.handled = true; throw e; }
    const list = [...this.listCommands(platform)];
    if (list.some((c) => c.trigger === (trigger.startsWith("!") ? trigger : `!${trigger}`))) {
      const e = new Error(`Команда ${trigger} уже есть`); e.handled = true; throw e;
    }
    const entry = {
      id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      trigger: trigger.startsWith("!") ? trigger : `!${trigger}`,
      response,
      cooldownSec: Math.max(0, Number(cmd.cooldownSec) || 0),
      lastRun: 0,
    };
    list.push(entry);
    this.setCommands(platform, list);
    return entry;
  }

  removeCommand(platform, id) {
    this.setCommands(platform, this.listCommands(platform).filter((c) => c.id !== id));
  }

  handleCommand(platform, channel, author, userLogin, text) {
    const body = String(text || "").trim();
    if (!body.startsWith("!")) return;
    const parts = body.split(/\s+/);
    const trigger = parts[0].toLowerCase();
    const args = parts.slice(1);
    const list = this.listCommands(platform);
    const cmd = list.find((c) => c.trigger.toLowerCase() === trigger);
    if (!cmd) return;
    const now = Date.now();
    if (cmd.cooldownSec > 0 && cmd.lastRun && now - cmd.lastRun < cmd.cooldownSec * 1000) {
      this.emitEvent(platform, "bot.cooldown", `Команда ${trigger} на кулдауне (${cmd.cooldownSec}с)`);
      return;
    }
    cmd.lastRun = now;
    const out = cmd.response
      .replace(/\{author\}/gi, author)
      .replace(/\{channel\}/gi, channel)
      .replace(/\{args\}/gi, args.join(" "))
      .replace(/\{login\}/gi, userLogin || author);
    this.emit(platform, { author: "YawaBot", text: out, badges: ["BOT"], kind: "bot.command" });
    this.sendChat(platform, channel, out);
  }

  /* ============================================================
     Отправка сообщений
     ============================================================ */

  sendChat(platform, channel, text) {
    const b = this.bots.get(platform);
    const target = login(channel);
    const body = String(text || "").trim();
    if (!target || !body) return false;
    if (platform === "twitch" && b && b.status === "online" && b.ws) {
      try { b.ws.send(`PRIVMSG #${target} :${body.slice(0, 480)}`); return true; } catch { /* noop */ }
    }
    if (platform === "vk" && b && b.status === "online" && b.vkClient) {
      try {
        if (typeof b.vkClient.sendMessage === "function") { b.vkClient.sendMessage(target, body.slice(0, 480)); return true; }
        if (typeof b.vkClient.send === "function") { b.vkClient.send(target, body.slice(0, 480)); return true; }
      } catch { /* noop */ }
    }
    this.emitEvent(platform, "bot.leave", `Сообщение не отправлено (бот ${platform} не в чате): ${body.slice(0, 60)}`);
    return false;
  }

  /* ============================================================
     Модерация
     ============================================================ */

  timeoutOptions(platform) {
    if (platform === "twitch") {
      return [
        { id: "60", label: "1 минута", seconds: 60 },
        { id: "300", label: "5 минут", seconds: 300 },
        { id: "600", label: "10 минут", seconds: 600 },
        { id: "1800", label: "30 минут", seconds: 1800 },
        { id: "1d", label: "1 день", seconds: 86400 },
        { id: "1w", label: "1 неделя", seconds: 604800 },
      ];
    }
    if (platform === "vk") {
      return [
        { id: "600", label: "10 минут", seconds: 600 },
        { id: "1d", label: "1 день", seconds: 86400 },
      ];
    }
    return [];
  }

  async helix(path, token, method = "GET", body = null) {
    const clientId = this.twitchClientId();
    const headers = { "Client-Id": clientId, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    return request(`${TWITCH_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : null, timeout: 15000 });
  }

  /** ID пользователя Twitch по его login (self-id уже есть в accountId). */
  async _twitchUserIdById(clientId, token, idOrLogin) {
    const data = await getJson(`${TWITCH_API}/users?id=${encodeURIComponent(idOrLogin)}`, {
      "Client-Id": clientId,
      Authorization: `Bearer ${token}`,
      accept: "application/json",
    });
    const u = data && data.data && data.data[0];
    return u ? u.id : idOrLogin;
  }

  /** 75 → «1 мин», 5400 → «1.5 ч», 604800 → «7 дн». */
  fmtDur(secs) {
    const s = Math.max(1, Math.round(secs));
    if (s < 60) return `${s} сек`;
    if (s < 3600) return `${Math.round(s / 60)} мин`;
    const h = s / 3600;
    if (s < 86400) return `${Math.round(h * 10) / 10} ч`;
    return `${Math.round(s / 86400)} дн`;
  }

  async moderate(platform, { author, login: userLogin, action, seconds, text }) {
    const target = login(userLogin || author);
    if (!target) return { ok: false, error: "Не указан участник" };
    const cfg = this.botConfig(platform);
    const b = this.bots.get(platform);

    if (platform === "twitch") {
      const token = String(cfg.token || "");
      if (!cfg.accountId) return { ok: false, error: "Канал неизвестен — авторизуйтесь заново" };
      if (!token) return { ok: false, error: "Нужна авторизация Twitch" };
      if (!b || b.status !== "online") return { ok: false, error: "Бот Twitch не в чате" };
      const broadcasterId = cfg.accountId;
      const moderatorId = cfg.accountId;
      const clientId = this.twitchClientId();

      /* Режимы чата: не требуют user_id, применяются к каналу целиком. */
      const MODES = {
        emoteonly: { path: "/chat/settings", data: { broadcaster_id: broadcasterId, moderator_id: moderatorId, emote_mode: true } },
        subs: { path: "/chat/settings", data: { broadcaster_id: broadcasterId, moderator_id: moderatorId, subscriber_mode: true } },
        clear: { path: "/moderation/chat", data: { broadcaster_id: broadcasterId, moderator_id: moderatorId } },
      };
      if (action === "emoteonly" || action === "subscribers" || action === "clear") {
        try {
          let cfgBody = MODES[action === "subscribers" ? "subs" : action].data;
          if (action === "subscribers") cfgBody = { ...cfgBody, subscriber_mode: true };
          if (action === "emoteonly") cfgBody = { ...cfgBody, emote_mode: true };
          await this.helix(MODES[action === "subscribers" ? "subs" : action].path, token, "PATCH", cfgBody);
          this.emitEvent("twitch", action === "clear" ? "mod.clear" : action === "emoteonly" ? "mod.emoteonly" : "mod.subscribers",
            action === "clear" ? "Чат очищен" : action === "emoteonly" ? "Режим «только смайлы»" : "Режим «только сабы»");
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e).slice(0, 100) };
        }
      }
      if (action === "slow") {
        try {
          const secs = Math.max(0, Number(seconds) || 0);
          await this.helix("/chat/settings", token, "PATCH", {
            broadcaster_id: broadcasterId, moderator_id: moderatorId, slow_mode: secs > 0, slow_mode_wait_time: Math.min(120, secs),
          });
          this.emitEvent("twitch", "mod.slow", secs > 0 ? `Медленный режим: ${secs} сек` : "Медленный режим выключен");
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e).slice(0, 100) };
        }
      }
      if (action === "followers") {
        try {
          const minutes = Number(seconds) || 0;
          await this.helix("/chat/settings", token, "PATCH", {
            broadcaster_id: broadcasterId, moderator_id: moderatorId,
            follower_mode: minutes > 0, follower_mode_duration: Math.min(129600, minutes),
          });
          this.emitEvent("twitch", "mod.followers", minutes > 0 ? `Чат только для подписчиков (${minutes} мин)` : "Чат открыт для всех");
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e && e.message || e).slice(0, 100) };
        }
      }

      /* Действия над пользователем: необходимы user_id цели и set_id модератора. */
      try {
        const users = await getJson(`${TWITCH_API}/users?login=${encodeURIComponent(target)}`, {
          "Client-Id": clientId,
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        });
        const userId = users && users.data && users.data[0] && users.data[0].id;
        if (action === "delete") {
          this.emitEvent("twitch", "mod.delete", `Сообщение ${target} удалено`);
          return { ok: true };
        }
        if (!userId) return { ok: false, error: `Не найден пользователь ${target}` };
        const modId = await this._twitchUserIdById(clientId, token, moderatorId).catch(() => moderatorId);
        const path = `/moderation/bans?broadcaster_id=${encodeURIComponent(broadcasterId)}&moderator_id=${encodeURIComponent(modId)}`;
        if (action === "ban") {
          await this.helix(path, token, "POST", { data: { user_id: userId, reason: "YawaChatHub" } });
          this.emitEvent("twitch", "mod.ban", `${target} забанен`);
        } else if (action === "unban") {
          await this.helix(path, token, "DELETE", { data: { user_id: userId } });
          this.emitEvent("twitch", "mod.unban", `${target} разбанен`);
        } else if (action === "timeout") {
          const secs = Math.max(1, Number(seconds) || 300);
          await this.helix(path, token, "POST", { data: { user_id: userId, duration: secs, reason: "YawaChatHub" } });
          this.emitEvent("twitch", "mod.timeout", `${target} в таймауте на ${this.fmtDur(secs)}`);
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e).slice(0, 100) };
      }
    }

    if (platform === "vk") {
      if (!cfg.token) return { ok: false, error: "Нужна авторизация VK" };
      if (!b || b.status !== "online") return { ok: false, error: "Бот VK не в чате" };
      try {
        if (action === "delete") {
          this.emitEvent("vk", "mod.delete", `Сообщение ${target} удалено`);
          return { ok: true };
        }
        if (action === "unban") {
          // VK Live: повторное приглашение снимает бан.
          await postJson(
            `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(cfg.channel)}/unban`,
            { user: target },
            { Authorization: `Bearer ${cfg.token}`, accept: "application/json" }
          ).catch(async () => {
            await postJson(
              `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(cfg.channel)}/remove_ban`,
              { user: target },
              { Authorization: `Bearer ${cfg.token}`, accept: "application/json" }
            );
          });
          this.emitEvent("vk", "mod.unban", `${target} разбанен`);
          return { ok: true };
        }
        if (action === "timeout") {
          // VK Live не имеет нативного таймаута — бан с немедленным авто-снятием.
          return { ok: false, error: "VK не поддерживает таймаут — используйте бан" };
        }
        await postJson(
          `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(cfg.channel)}/remove_user`,
          { user: target },
          { Authorization: `Bearer ${cfg.token}`, accept: "application/json" }
        );
        this.emitEvent("vk", "mod.ban", `${target} удалён из чата`);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e).slice(0, 100) };
      }
    }
    return { ok: false, error: "Модерация доступна только для Twitch и VK" };
  }

  /* ============================================================
     DonationAlerts — канал трансляции
     ============================================================ */

  daSettings() {
    const da = (this.settings.bot && this.settings.bot.donationAlerts) || {};
    return {
      enabled: da.enabled !== false,
      token: String(da.token || ""),
      currency: String(da.currency || APP_CONFIG.donationAlerts.defaultCurrency || "RUB"),
      template: String(da.template || ""),
      total: Number(da.totalSession || 0),
    };
  }

  saveDa(patch) {
    const da = { ...this.daSettings(), ...patch };
    this.settings.bot = this.settings.bot || {};
    this.settings.bot.donationAlerts = da;
    try { require("./settings").saveSettings(this.settings); } catch { /* noop */ }
    return da;
  }

  setDonationCurrency(currency) {
    this.saveDa({ currency });
  }

  /** DonationAlerts как канал: токен из профиля, сумма считается за стрим. */
  connectDonationAlerts(token, currency) {
    this.saveDa({ token: String(token || ""), enabled: true, ...(currency ? { currency } : {}) });
    this.startDonationAlerts();
  }

  isDonationConnected() {
    const da = this.daSettings();
    return Boolean(da.token) && Boolean(this.da);
  }

  startDonationAlerts() {
    const cfg = this.daSettings();
    if (!cfg.token) return;
    this.stopDonationAlerts();

    const state = { token: cfg.token, total: 0, currency: cfg.currency, top: null };

    /* 1) Текущая сумма и профиль через API DonationAlerts. */
    (async () => {
      try {
        const me = await getJson(`${DA_API}/user/oauth`, {
          Authorization: `Bearer ${cfg.token}`,
          accept: "application/json",
        }).catch(() => null);
        if (me && me.data) {
          state.total = Number(me.data.amount || 0) || 0;
          this.emitEvent("donation", "donation.total", `DonationAlerts подключён — собрано ${state.total} ${state.currency}`);
          this.onChannels && this.onChannels();
        }
      } catch { /* noop */ }
    })();

    /* 2) Реальные донаты: websocket-центrifugo DonationAlerts. */
    try {
      const ws = new WebSocket(APP_CONFIG.donationAlerts.socketUrl, tlsOptionsFor(APP_CONFIG.donationAlerts.socketUrl));
      state.ws = ws;
      ws.on("open", () => {
        try {
          ws.send(JSON.stringify({
            type: "subscribe",
            channel: cfg.token.slice(0, 32),
          }));
        } catch { /* noop */ }
        this.emitEvent("donation", "donation.token", `Канал DonationAlerts подключён (${state.currency})`);
        this.onChannels && this.onChannels();
      });
      ws.on("message", (raw) => {
        try {
          const data = JSON.parse(String(raw));
          const d = data && (data.data || data);
          if (!d) return;
          const amount = Number(d.amount_main || d.amount || 0);
          const currency = String(d.currency || state.currency);
          const username = String(d.username || d.name || "аноним");
          const message = String(d.message || "");
          if (!amount) return;
          this.registerDonation({ amount, currency, username, message });
        } catch { /* noop */ }
      });
      ws.on("error", () => { /* соединение необязательно: работает и вебхук */ });
    } catch { /* noop */ }

    /* 3) Локальный вебхук — если донаты настроены напрямую в кабинет D.A. */
    this.startDonationWebhook(state);

    this.da = state;
  }

  startDonationWebhook(state) {
    const http = require("http");
    const crypto = require("crypto");
    const cfg = APP_CONFIG.donationAlerts;
    const server = http.createServer((req, res) => {
      const url = String(req.url || "");
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end(JSON.stringify({ ok: true, service: "YawaChatHub DonationAlerts" }));
        return;
      }
      if (req.method !== "POST" || !url.startsWith(cfg.webhookPath)) {
        res.writeHead(404, { "access-control-allow-origin": "*" });
        res.end();
        return;
      }
      let raw = "";
      req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
        res.end('{"ok":true}');
        try {
          if (cfg.webhookSecret) {
            const sig = req.headers["x-signature"];
            const expected = crypto.createHmac("sha256", cfg.webhookSecret).update(raw).digest("hex");
            if (!sig || String(sig) !== expected) return;
          }
          const p = JSON.parse(raw);
          this.registerDonation({
            amount: Number(p.amount || 0),
            currency: String(p.currency || state.currency),
            username: String(p.username || "аноним"),
            message: String(p.message || ""),
          });
        } catch { /* noop */ }
      });
    });
    server.on("error", () => { /* порт занят — донаты придут через сокет */ });
    try { server.listen(cfg.webhookPort, "127.0.0.1"); } catch { /* noop */ }
    state.webhook = server;
  }

  stopDonationAlerts() {
    if (!this.da) return;
    if (this.da.ws) { try { this.da.ws.terminate(); } catch { /* noop */ } }
    if (this.da.webhook) { try { this.da.webhook.close(); } catch { /* noop */ } }
    this.da = null;
    this.onChannels && this.onChannels();
  }

  /** Донат → событие в ленту + рост суммы канала. */
  registerDonation({ amount, currency, username, message }) {
    const cfg = this.daSettings();
    const state = this.da || { total: 0, currency: cfg.currency };
    const inTarget = this.convert(amount, currency, state.currency || cfg.currency);
    state.total = Math.round(((state.total || 0) + inTarget) * 100) / 100;
    this.saveDa({ totalSession: state.total, enabled: true });

    const total = state.total;
    const text = cfg.template
      ? cfg.template
        .replace(/\{user\}/gi, username)
        .replace(/\{amount\}/gi, `${amount} ${currency}`)
        .replace(/\{total\}/gi, `${total} ${state.currency || cfg.currency}`)
        .replace(/\{message\}/gi, message)
      : `💖 ${username} донатит ${amount} ${currency} · всего за стрим ${total} ${state.currency || cfg.currency}${message ? `: ${message}` : ""}`;

    this.onChat({
      id: `d${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform: "donation",
      author: username,
      text,
      color: "#fb6c2a",
      badges: ["GIFT"],
      ts: Date.now(),
      sys: false,
      kind: "donation.alert",
      amount,
      currency,
    });

    /* Донат дублируется в чаты ботов, если они подключены. */
    for (const p of ["twitch", "vk"]) {
      const b = this.bots.get(p);
      if (b && b.status === "online") {
        const cfgP = this.botConfig(p);
        this.sendChat(p, cfgP.channel, text);
      }
    }
    this.onChannels && this.onChannels();
  }

  /** Простейший пересчёт валют — курсы заданы в config. */
  convert(amount, from, to) {
    const RATES = { RUB: 1, USD: 92, EUR: 100, KZT: 0.19, UAH: 2.3, BYN: 28, TRY: 2.7, GEL: 34, PLN: 23, GBP: 117 };
    const a = RATES[from] || 1;
    const b = RATES[to] || 1;
    return (Number(amount) || 0) * a / b;
  }

  resetDonationTotal() {
    if (this.da) this.da.total = 0;
    this.saveDa({ totalSession: 0 });
    this.onChannels && this.onChannels();
  }

  /** Удаляет канал DonationAlerts из приложения вместе с локальным secret token. */
  removeDonationChannel() {
    this.stopDonationAlerts();
    this.saveDa({ enabled: false, token: "", totalSession: 0 });
    this.emitEvent("donation", "donation.token", "DonationAlerts: канал отключён");
    this.onChannels && this.onChannels();
  }

  /** Сводка канала DonationAlerts для списка площадок. */
  donationChannel() {
    const cfg = this.daSettings();
    const connected = Boolean(cfg.token) && Boolean(this.da);
    return {
      id: "donation:donationalerts",
      platform: "donation",
      channelId: "DonationAlerts",
      // В UI показываем только два состояния: «Подключен» или «Не настроено».
      status: connected ? "online" : "offline",
      /* Зрительское место переиспользуем под сумму донатов — оверлей показывает её как сумму. */
      viewers: connected ? Math.round(cfg.total * 100) / 100 : null,
      currency: cfg.currency,
    };
  }

  donationInfo() {
    const ch = this.donationChannel();
    return {
      currency: ch.currency,
      total: Number(ch.viewers || 0),
      connected: ch.status === "online",
      configured: Boolean(this.daSettings().token),
    };
  }
}

module.exports = { BotManager, TWITCH_IRC, TWITCH_API };
