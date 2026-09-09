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
const TWITCH_EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";
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

/** Парсит нативные Twitch-emotes из IRC-тега emotes в части с URL картинок. */
function parseTwitchEmotes(text, emotesTag) {
  if (!emotesTag || typeof emotesTag !== "string") return null;
  const ranges = [];
  for (const part of emotesTag.split("/")) {
    const [id, list] = part.split(":");
    if (!id || !list) continue;
    for (const r of list.split(",")) {
      const [s, e] = r.split("-").map((n) => parseInt(n, 10));
      if (Number.isNaN(s) || Number.isNaN(e)) continue;
      ranges.push({ id, start: s, end: e });
    }
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a.start - b.start);
  const out = [];
  let pos = 0;
  for (const range of ranges) {
    if (range.start > pos) out.push({ type: "text", value: text.slice(pos, range.start) });
    const name = text.slice(range.start, range.end + 1);
    out.push({
      type: "emote",
      value: name,
      url: `https://static-cdn.jtvnw.net/emoticons/v2/${range.id}/default/dark/2.0`,
    });
    pos = range.end + 1;
  }
  if (pos < text.length) out.push({ type: "text", value: text.slice(pos) });
  return out;
}

/* ============================================================
   BotManager
   ============================================================ */

class BotManager {
  constructor({ settings, onChat, onBotStatus, onChannels, onToken, onAuthorizedChannel, onChannelRevoked }) {
    this.settings = settings;
    this.onChat = onChat;
    this.onBotStatus = onBotStatus;
    this.onChannels = onChannels;
    this.onToken = onToken;
    this.onAuthorizedChannel = onAuthorizedChannel;
    this.onChannelRevoked = onChannelRevoked;

    this.bots = new Map(); // platform -> bot runtime
    this.da = null;        // DonationAlerts runtime
    this.commands = new Map(); // platform -> [{ id, trigger, response, cooldownSec, lastRun }]
  }

  /* ---------------- сообщения ---------------- */

  emit(platform, { author, text, color, badges, kind, amount, currency, parts }) {
    if (!text) return;
    // Название бота, который пишет системные действия и события — СТРОГО YawaChatHub.
    const finalAuthor = (badges && badges.includes("BOT")) || !author ? "YawaChatHub" : author;
    this.onChat({
      id: `b${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      platform,
      author: finalAuthor,
      text: String(text),
      color: color || "#4c8dff",
      badges: badges || [],
      ts: Date.now(),
      sys: false,
      kind: kind || "chat.message",
      amount,
      currency,
      parts: parts || undefined,
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
  async handleOAuthToken(platform, token, extra = {}) {
    // Нормализуем токен: у Twitch implicit-flow отдаёт «raw», у ручного ввода
    // может встретиться префикс «oauth:» — Helix принимает только raw.
    const clean = String(token || "").trim().replace(/^oauth:/, "");
    this.saveBot(platform, { token: clean, enabled: true });
    const info = await this.resolveAccount(platform, clean, extra).catch(() => null);
    if (info) {
      this.saveBot(platform, { ...info, token: clean, enabled: true });
      // Канал сразу появляется в «Каналы» (онлайн/зрители от обычного коннектора),
      // а текст сообщений идёт только от авторизованного бота — без дублей.
      if (this.onAuthorizedChannel) {
        try { this.onAuthorizedChannel(platform, info.channel); } catch { /* noop */ }
      }
    }
    // Сбрасываем флаг joinedChannel, чтобы при первой реальной фиксации
    // входа в чат эмитился ровно ОДИН факт подключения, без спама.
    const b = this.runtime(platform);
    b.joinedChannel = null;
    // Сначала сообщаем интерфейсу об успешной авторизации: раньше событие шло
    // ПОСЛЕ connect(), и любое исключение при подключении (например, VK-клиент)
    // оставляло карточку площадки в состоянии «не авторизован», хотя токен уже был сохранён.
    if (this.onToken) {
      try { this.onToken({ platform, account: info && info.account, channel: info && info.channel }); } catch { /* noop */ }
    }
    this.flushStatus();
    try {
      this.connect(platform);
    } catch (e) {
      this.setStatus(b, "error", String(e && e.message ? e.message : e));
    }
  }

  /** Авторизация: узнать ник аккаунта и его канал — пользователь ничего не вводит. */
  async resolveAccount(platform, token, extra = {}) {
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
      // 1) VK ID OAuth 2.1: /oauth2/user_info (официальный endpoint VK ID)
      const clientId = APP_CONFIG.vk.clientId;
      // VK ID принимает только application/x-www-form-urlencoded (JSON → invalid_request).
      // device_id обязателен для user_info — передаём полученный при авторизации.
      const idParams = { client_id: clientId, access_token: token };
      if (extra.deviceId) idParams.device_id = extra.deviceId;
      const idForm = new URLSearchParams(idParams).toString();
      const idHeaders = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
      let idRes = null;
      for (const host of ["https://id.vk.ru", "https://id.vk.com"]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await request(`${host}/oauth2/user_info`, { method: "POST", headers: idHeaders, body: idForm, timeout: 10000 }).catch(() => null);
        if (r && r.ok) {
          try { idRes = JSON.parse(r.body || "{}"); } catch { idRes = null; }
          if (idRes && idRes.user) break;
        }
      }
      const idUser = idRes && idRes.user;

      // 2) VK API: users.get
      const apiRes = await getJson(
        `https://api.vk.com/method/users.get?fields=screen_name,domain&access_token=${encodeURIComponent(token)}&v=5.199`,
        { accept: "application/json" }
      ).catch(() => null);
      const apiUser = apiRes && apiRes.response && apiRes.response[0];

      const uid = String((idUser && idUser.user_id) || (apiUser && apiUser.id) || extra.userId || "").trim();
      const screen = (apiUser && (apiUser.screen_name || apiUser.domain)) || (uid ? `id${uid}` : "vk_user");
      const name = idUser
        ? `${idUser.first_name || ""} ${idUser.last_name || ""}`.trim()
        : apiUser
        ? `${apiUser.first_name || ""} ${apiUser.last_name || ""}`.trim()
        : screen;

      return {
        account: screen.toLowerCase(),
        channel: screen.toLowerCase(),
        accountId: uid,
        displayName: name || screen,
      };
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
    if (b) {
      this.teardown(b);
      b.joinedChannel = null;
    }
    this.saveBot(platform, { enabled: false });
    this.runtime(platform).status = "offline";
    this.flushStatus();
  }

  /**
   * Сброс подключения канала (НЕ авторизация): вызывается, когда пользователь
   * отключает канал из списка каналов (крестик). Токен остаётся сохранённым,
   * но активная сессия бота останавливается, канал в конфиге сбрасывается.
   */
  onChannelRemoved(platform, channelId) {
    const cfg = this.botConfig(platform);
    const norm = (s) => String(s || "").trim().toLowerCase().replace(/^[@#]/, "");
    if (!channelId || norm(cfg.channel) === norm(channelId)) {
      const b = this.bots.get(platform);
      if (b) {
        this.teardown(b);
        b.joinedChannel = null;
      }
      this.saveBot(platform, { channel: "", enabled: false });
      this.runtime(platform).status = "offline";
      this.emitEvent(platform, "bot.leave", `Чат-бот ${platform === "twitch" ? "Twitch" : "VK"}: подключение канала сброшено`);
      this.flushStatus();
    }
  }

  /** Полное отключение: токен удаляется, бот выходит. */
  revoke(platform) {
    const b = this.bots.get(platform);
    if (b) {
      this.teardown(b);
      b.joinedChannel = null;
    }
    const oldChannel = this.botConfig(platform).channel;
    this.saveBot(platform, { token: "", enabled: false, account: "", channel: "", accountId: "" });
    this.runtime(platform).status = "offline";
    this.emitEvent(platform, "bot.leave", `Чат-бот: авторизация ${platform} отменена`);
    this.flushStatus();
    if (oldChannel && this.onChannelRevoked) {
      try { this.onChannelRevoked(platform, oldChannel); } catch { /* noop */ }
    }
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
    if (b.eventSubWs) { try { b.eventSubWs.terminate(); } catch { /* noop */ } b.eventSubWs = null; }
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
      send(`USER ${nick} 8 * :${nick}`);
      send(`JOIN #${channel}`);
      b.ping = setInterval(() => send("PING :tmi.twitch.tv"), 60000);
    });

    ws.on("message", (raw) => {
      if (!b.alive) return;
      for (const line of raw.toString().split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) { send("PONG :tmi.twitch.tv"); continue; }
        const msg = parseIrc(line);

        // FIX: реагируем только на 001/366 и проверяем joinedChannel —
        // раньше реагировало на каждый JOIN (в IRC приходит для каждого вошедшего
        // в чат зрителя!) и спамило событием «Чат-бот подключён» многократно.
        if (msg.command === "001" || msg.command === "366") {
          const firstJoin = b.joinedChannel !== channel;
          b.joinedChannel = channel;
          this.setStatus(b, "online");
          if (firstJoin) {
            this.emitEvent("twitch", "bot.join", `Twitch: чат-бот подключён к #${channel}`);
            this.watchTwitchFollowers(b, cfg);
            this.startTwitchEventSub(b, cfg);
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
          if (map[kind]) {
            this.emit("twitch", { author: "YawaChatHub", text: map[kind][1], badges: ["BOT"], kind: map[kind][0] });
            continue;
          }
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

          // Награды за баллы канала (channel points с пользовательским текстом):
          if (msg.tags["custom-reward-id"]) {
            this.emit("twitch", {
              author: "YawaChatHub",
              text: `${author} активировал(а) награду за баллы: ${text}`,
              badges: ["BOT"],
              kind: "sys.reward",
            });
            continue;
          }
          // Биты / Cheers:
          if (msg.tags["bits"]) {
            this.emit("twitch", {
              author: "YawaChatHub",
              text: `${author} отправил(а) ${msg.tags["bits"]} бит: ${text}`,
              badges: ["BOT"],
              kind: "sys.cheer",
            });
            continue;
          }
          // Выделенное сообщение:
          if (msg.tags["msg-id"] === "highlighted-message") {
            this.emit("twitch", {
              author,
              text,
              color: msg.tags.color || "",
              badges,
              kind: "chat.highlighted",
            });
            continue;
          }

          /* Тип события — по нему работает фильтр «Лента → События». */
          const first = msg.tags["first-msg"] === "1";
          const kind = text.startsWith("!") ? "chat.command"
            : first ? "chat.first"
            : /https?:\/\//i.test(text) ? "chat.link"
            : "chat.message";

          const parts = parseTwitchEmotes(text, msg.tags.emotes);
          this.emit("twitch", { author, text, color: msg.tags.color || "", badges, kind, parts: parts || undefined });
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

  /**
   * Подписки/отслеживания: периодический опрос Helix.
   *
   * FIX: раньше на самом первом опросе (сразу после авторизации) в список
   * `seenFollowers` добавлялись уже существующие подписчики канала, и почти
   * для всех них тут же летело событие «X подписался на канал» — то есть
   * пользователь видел спам из старых, давно известных подписок. Теперь
   * первый опрос только формирует базовый список (baseline) БЕЗ единого
   * события; события «новый подписчик» эмитятся лишь на последующих опросах,
   * когда появляется имя, которого не было в baseline.
   */
  watchTwitchFollowers(b, cfg) {
    const clientId = this.twitchClientId();
    const token = String(cfg.token || "");
    if (!clientId || !token) return;
    let seeded = false;
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
        if (Array.isArray(list)) {
          b.followCount = Number(data && data.total != null ? data.total : list.length);
          if (!seeded) {
            // Baseline: запоминаем уже существующих подписчиков молча.
            for (const f of list) {
              const name = f.user_name || f.user_login;
              if (name) b.seenFollowers.add(String(name).toLowerCase());
            }
            seeded = true;
          } else {
            for (const f of list) {
              const name = f.user_name || f.user_login;
              if (!name) continue;
              const key = String(name).toLowerCase();
              if (b.seenFollowers.has(key)) continue;
              b.seenFollowers.add(key);
              // Не даём множеству расти бесконечно на долгих стримах.
              if (b.seenFollowers.size > 5000) {
                const first = b.seenFollowers.values().next().value;
                b.seenFollowers.delete(first);
              }
              this.emit("twitch", { author: "YawaChatHub", text: `${name} подписался на канал 🎉`, badges: ["BOT"], kind: "sys.follow" });
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

  /**
   * Twitch EventSub (WebSocket) — события, которых нет в IRC:
   * активация наград за баллы канала (channel points redemption).
   *
   * Раньше подписки на этот топик не было вообще, поэтому раздел ленты
   * «Награда канала» (sys.reward) никогда не наполнялся событиями.
   * EventSub — push-канал без истории: подписка создаётся заново при каждом
   * подключении и присылает только события, случившиеся ПОСЛЕ подписки —
   * старые/прошлые активации наград не приходят (не спамит историей).
   */
  startTwitchEventSub(b, cfg) {
    if (b.eventSubWs) return;
    let ws;
    try {
      ws = new WebSocket(TWITCH_EVENTSUB_WS, tlsOptionsFor(TWITCH_EVENTSUB_WS));
    } catch {
      return;
    }
    b.eventSubWs = ws;
    ws.on("message", (raw) => this.handleTwitchEventSubMessage(b, cfg, ws, raw));
    ws.on("close", () => { if (b.eventSubWs === ws) b.eventSubWs = null; });
    ws.on("error", () => { try { ws.close(); } catch { /* noop */ } });
  }

  async handleTwitchEventSubMessage(b, cfg, ws, raw) {
    let data;
    try { data = JSON.parse(String(raw)); } catch { return; }
    const type = data && data.metadata && data.metadata.message_type;
    if (type === "session_welcome") {
      const sessionId = data.payload && data.payload.session && data.payload.session.id;
      if (sessionId) await this.subscribeTwitchEventSub(cfg, sessionId);
      return;
    }
    if (type === "session_reconnect") {
      // Twitch просит переподключиться на новый URL — старую подписку переносить не нужно.
      const url = data.payload && data.payload.session && data.payload.session.reconnect_url;
      if (url && b.alive) {
        try { ws.terminate(); } catch { /* noop */ }
        let next;
        try { next = new WebSocket(url, tlsOptionsFor(url)); } catch { return; }
        b.eventSubWs = next;
        next.on("message", (r2) => this.handleTwitchEventSubMessage(b, cfg, next, r2));
        next.on("close", () => { if (b.eventSubWs === next) b.eventSubWs = null; });
        next.on("error", () => { try { next.close(); } catch { /* noop */ } });
      }
      return;
    }
    if (type !== "notification") return;
    const subType = data.payload && data.payload.subscription && data.payload.subscription.type;
    const event = (data.payload && data.payload.event) || {};
    if (subType === "channel.channel_points_custom_reward_redemption.add") {
      const who = event.user_name || event.user_login || "зритель";
      const reward = (event.reward && event.reward.title) || "награда";
      const cost = (event.reward && event.reward.cost) ? ` (${event.reward.cost} баллов)` : "";
      const input = event.user_input ? `: ${event.user_input}` : "";
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `${who} активировал(а) награду «${reward}»${cost}${input}`,
        badges: ["BOT"],
        kind: "sys.reward",
      });
      return;
    }
    if (subType === "channel.cheer") {
      const who = event.is_anonymous ? "Аноним" : (event.user_name || event.user_login || "зритель");
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `${who} отправил(а) ${event.bits} бит! ${event.message || ""}`,
        badges: ["BOT"],
        kind: "sys.cheer",
      });
      return;
    }
    if (subType === "channel.raid") {
      const from = event.from_broadcaster_user_name || event.from_broadcaster_user_login || "зритель";
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `Рейд от ${from}: ${event.viewers} зрителей!`,
        badges: ["BOT"],
        kind: "mod.raid",
      });
      return;
    }
    if (subType === "channel.hype_train.begin") {
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `Hype Train начался! Уровень ${event.level || 1} 🔥`,
        badges: ["BOT"],
        kind: "sys.hype",
      });
      return;
    }
    if (subType === "channel.poll.begin") {
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `Опрос начался: «${event.title}»`,
        badges: ["BOT"],
        kind: "sys.poll",
      });
      return;
    }
    if (subType === "channel.prediction.begin") {
      this.emit("twitch", {
        author: "YawaChatHub",
        text: `Прогноз начался: «${event.title}»`,
        badges: ["BOT"],
        kind: "sys.prediction",
      });
      return;
    }
  }

  /** Оформляет подписку на EventSub-топики через Helix (нужен broadcaster/moderator токен). */
  async subscribeTwitchEventSub(cfg, sessionId) {
    const topics = [
      { type: "channel.channel_points_custom_reward_redemption.add", version: "1", condition: { broadcaster_user_id: cfg.accountId } },
      { type: "channel.cheer", version: "1", condition: { broadcaster_user_id: cfg.accountId } },
      { type: "channel.raid", version: "1", condition: { to_broadcaster_user_id: cfg.accountId } },
      { type: "channel.hype_train.begin", version: "1", condition: { broadcaster_user_id: cfg.accountId } },
      { type: "channel.poll.begin", version: "1", condition: { broadcaster_user_id: cfg.accountId } },
      { type: "channel.prediction.begin", version: "1", condition: { broadcaster_user_id: cfg.accountId } },
    ];
    for (const t of topics) {
      try {
        const res = await this.helix("/eventsub/subscriptions", cfg.token, "POST", {
          type: t.type,
          version: t.version,
          condition: t.condition,
          transport: { method: "websocket", session_id: sessionId },
        });
        if (!res.ok && res.status !== 409) {
          console.warn("[eventsub]", t.type, res.status);
        }
      } catch (error) {
        console.warn("[eventsub]", t.type, error && error.message);
      }
    }
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

    // Загружаем смайлы канала VK (эмодзи канала и глобальные VK)
    const vkEmotes = new Map();
    const loadVkEmotes = async () => {
      const endpoints = [
        `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channel)}/smile/user_set/`,
        `https://api.vkplay.live/v1/blog/${encodeURIComponent(channel)}/smile/user_set/`,
        `https://api.live.vkvideo.ru/v1/smile/user_set/`,
        `https://api.vkplay.live/v1/smile/user_set/`,
      ];
      for (const url of endpoints) {
        // eslint-disable-next-line no-await-in-loop
        const data = await getJson(url, { referer: `https://live.vkvideo.ru/${channel}` }).catch(() => null);
        const sets = data?.data?.sets || data?.sets || [];
        for (const set of sets) {
          for (const s of set?.smiles || []) {
            const link = s?.smallUrl || s?.mediumUrl || s?.largeUrl;
            if (s?.name && link) vkEmotes.set(String(s.name).toLowerCase(), link);
          }
        }
      }
    };
    loadVkEmotes().catch(() => {});

    const buildVkParts = (text, smiles) => {
      const registry = new Map(vkEmotes);
      for (const s of smiles || []) {
        const link = s?.smallUrl || s?.mediumUrl || s?.largeUrl;
        if (s?.name && link) {
          registry.set(String(s.name).toLowerCase(), link);
          registry.set(`:${String(s.name).toLowerCase()}:`, link);
        }
      }
      if (!registry.size) return undefined;
      const parts = [];
      let buf = "";
      const flush = () => { if (buf) { parts.push({ type: "text", value: buf }); buf = ""; } };
      for (const tok of String(text || "").split(/(\s+)/)) {
        if (!tok) continue;
        if (/^\s+$/.test(tok)) { buf += tok; continue; }
        const plain = tok.toLowerCase();
        const stripped = plain.replace(/^:+|:+$/g, "");
        const url = registry.get(plain) || registry.get(stripped) || registry.get(`:${stripped}:`);
        if (url) {
          flush();
          parts.push({ type: "emote", value: stripped, url });
        } else {
          buf += tok;
        }
      }
      flush();
      return parts.some((p) => p.type === "emote") ? parts : undefined;
    };

    // Пробуем подключение: readonly работает для любого канала без VK Play Live пароля
    let client;
    try {
      client = new VKPLMessageClient({ auth: "readonly", channels: [channel], debugLog: false, log: false });
    } catch {
      try {
        client = new VKPLMessageClient({ auth: "token", token, channels: [channel], debugLog: false, log: false });
      } catch (e) {
        this.setStatus(b, "error", `Не удалось создать подключение: ${String(e.message || e).slice(0, 60)}`);
        return;
      }
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
      const smiles = ctx?.message?.smiles || [];
      const parts = buildVkParts(text, smiles);
      this.emit("vk", {
        author,
        text,
        badges,
        kind: text.startsWith("!") ? "chat.command" : "chat.message",
        parts,
      });
      this.handleCommand("vk", channel, author, "", text);
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
        const firstJoin = b.joinedChannel !== channel;
        b.joinedChannel = channel;
        this.setStatus(b, "online");
        if (firstJoin) {
          this.emitEvent("vk", "bot.join", `VK: чат-бот подключён к ${channel}`);
          this.watchVkFollowers(b, token, channel);
        }
      } catch (e) {
        if (!b.alive) return;
        this.setStatus(b, "error", String(e.message || e).slice(0, 90));
      }
    })();
  }

  watchVkFollowers(b, token, channel) {
    let seeded = false;
    const run = async () => {
      if (!b.alive || b.status !== "online") return;
      try {
        const data = await getJson(
          `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(channel)}/public_info`,
          { Authorization: `Bearer ${token}`, accept: "application/json" }
        ).catch(() => null);
        const n = data && (data.data ? data.data.followers : data.followers);
        if (typeof n === "number") {
          if (!seeded) {
            b.followCount = n;
            seeded = true;
          } else if (n > b.followCount) {
            this.emit("vk", { author: "YawaChatHub", text: `Новый подписчик на VK Live! Всего ${n} 👍`, badges: ["BOT"], kind: "sys.follow" });
            b.followCount = n;
          }
          b.lastEvent = `подписчиков: ${b.followCount}`;
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
    this.emit(platform, { author: "YawaChatHub", text: out, badges: ["BOT"], kind: "bot.command" });
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
    const clean = String(token || "").trim();
    if (!clean) return;
    this.saveDa({ token: clean, enabled: true, ...(currency ? { currency } : {}) });
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

    // Карточка канала появляется сразу — без ожидания сокета/API.
    const state = { token: cfg.token, total: Number(cfg.total || 0), currency: cfg.currency, top: null, ws: null };
    this.da = state;
    this.emitEvent("donation", "donation.token", `DonationAlerts: канал подключён (${state.currency})`);
    this.onChannels && this.onChannels();
    this.connectDaSocket(state);
  }

  /**
   * Секретный токен виджета DonationAlerts работает через Socket.IO (EIO=3).
   * Неверный URL/протокол давал «долгий коннект» и тишину в ленте.
   */
  connectDaSocket(state) {
    const url = APP_CONFIG.donationAlerts.socketUrl;
    let ws;
    try {
      ws = new WebSocket(url, tlsOptionsFor(url));
    } catch (error) {
      console.warn("[donation] socket:", error && error.message);
      return;
    }
    state.ws = ws;
    const send = (payload) => { try { ws.send(payload); } catch { /* noop */ } };

    ws.on("open", () => {});
    ws.on("message", (raw) => {
      const msg = String(raw || "");
      if (msg.startsWith("0")) { send("40"); return; }
      if (msg === "40" || msg.startsWith("40")) {
        send("42" + JSON.stringify(["add-user", { token: state.token, type: "alert_widget" }]));
        this.onChannels && this.onChannels();
        return;
      }
      if (msg === "2") { send("3"); return; }
      if (!msg.startsWith("42")) return;
      try {
        const payload = JSON.parse(msg.slice(2));
        const event = payload && payload[0];
        let data = payload && payload[1];
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch { /* keep string */ }
        }
        if (event === "donation" && data && typeof data === "object") {
          this.registerDonation({
            amount: Number(data.amount_main || data.amount || 0),
            currency: String(data.currency || state.currency),
            username: String(data.username || data.name || "аноним"),
            message: String(data.message || ""),
          });
        }
      } catch { /* ignore non-donation frames */ }
    });
    ws.on("close", () => {
      if (this.da !== state) return;
      state.retry = setTimeout(() => { if (this.da === state) this.connectDaSocket(state); }, 4000);
    });
    ws.on("error", () => {});
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
    if (this.da.retry) { try { clearTimeout(this.da.retry); } catch { /* noop */ } }
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
    if (!cfg.token) return null;
    const connected = Boolean(this.da);
    return {
      id: "donation:donationalerts",
      platform: "donation",
      channelId: "DonationAlerts",
      status: connected ? "online" : "offline",
      viewers: connected ? Math.round((this.da.total || cfg.total || 0) * 100) / 100 : null,
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
