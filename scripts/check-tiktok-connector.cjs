/* Проверка коннектора TikTok. Запуск: node scripts/check-tiktok-connector.cjs
 *
 * Тесты подставляют поддельный класс соединения вместо настоящей библиотеки:
 * так проверяется именно наша логика — порядок подписки, выбор комнаты и
 * разбор сообщения, без обращения к TikTok.
 */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { ConnectorManager } = require(path.join(__dirname, "../desktop/electron/connectors.js"));
const source = fs.readFileSync(path.join(__dirname, "../desktop/electron/connectors.js"), "utf8");

let passed = 0;
const check = (name, fn) => fn().then(() => { passed++; console.log(`✓ ${name}`); });

/** Поддельное соединение с тем же интерфейсом, что у tiktok-live-connector v2. */
function makeFakeConnection({ failWithoutRoomId = false, offline = false } = {}) {
  const created = [];
  class FakeConn {
    constructor(uniqueId, options) {
      this.uniqueId = uniqueId;
      this.options = options;
      this.listeners = new Map();
      // Что было известно на момент каждого connect(): порядок подписок и roomId.
      this.connectCalls = [];
      created.push(this);
    }
    on(event, cb) {
      this.listeners.set(event, cb);
      return this;
    }
    emit(event, payload) {
      const cb = this.listeners.get(event);
      if (cb) cb(payload);
    }
    async connect(roomId) {
      this.connectCalls.push({ roomId, subscribed: [...this.listeners.keys()] });
      if (offline) {
        const err = new Error("The requested user isn't online :(");
        err.name = "UserOfflineError";
        throw err;
      }
      if (failWithoutRoomId && !roomId) {
        throw new Error("Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok.");
      }
      return { roomInfo: { liveRoomStats: { userCount: 42 } } };
    }
    disconnect() {}
  }
  return { FakeConn, created };
}

/** Менеджер с подменённой загрузкой библиотеки и перехватом сообщений. */
function makeManager(FakeConn, { roomLookup } = {}) {
  const chat = [];
  const status = [];
  const cm = new ConnectorManager({
    settings: { channels: [] },
    onChat: (m) => chat.push(m),
    onStatus: (list) => status.push(list),
  });
  cm._getTikTokConnector = async () => FakeConn;
  // Подменяем сетевой поиск комнаты, чтобы тест не ходил в интернет.
  if (roomLookup) cm._lookupTikTokRoom = roomLookup;
  return { cm, chat, status };
}

const makeEntry = (channelId = "@streamer") => ({
  channel: { platform: "tiktok", channelId },
  status: "connecting",
  attempts: 0,
  alive: true,
});

/** Канал в тестах создаётся вручную, поэтому таймеры снимаем сами. */
const cleanup = (cm, entry) => {
  entry.alive = false;
  if (entry.silenceTimer) clearTimeout(entry.silenceTimer);
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.viewersTimer) clearTimeout(entry.viewersTimer);
  cm.stopAll();
};

(async () => {
  await check("Подписки на сообщения ставятся до connect(), иначе первый пакет теряется", async () => {
    const { FakeConn, created } = makeFakeConnection();
    const { cm } = makeManager(FakeConn);
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 20));

    const client = created[0];
    assert.ok(client, "клиент создан");
    assert.equal(client.connectCalls.length >= 1, true, "connect() вызван");
    const first = client.connectCalls[0];
    assert.ok(first.subscribed.includes("chat"), "подписка chat оформлена до connect()");
    assert.ok(first.subscribed.includes("roomUser"), "подписка roomUser оформлена до connect()");
    assert.ok(first.subscribed.includes("error"), "подписка error оформлена до connect()");
    cleanup(cm, entry);
  });

  await check("Комнату ищет сама библиотека — свой roomId не подставляется без нужды", async () => {
    const { FakeConn, created } = makeFakeConnection();
    const { cm } = makeManager(FakeConn, {
      roomLookup: async () => ({ roomId: "7777777", viewers: 10, isLive: true }),
    });
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 20));

    const calls = created[0].connectCalls;
    assert.equal(calls.length, 1, "хватило одной попытки");
    assert.equal(calls[0].roomId, undefined, "штатный путь идёт без подмены комнаты");
    cleanup(cm, entry);
  });

  await check("Если библиотека не нашла комнату, подставляется наш roomId", async () => {
    const { FakeConn, created } = makeFakeConnection({ failWithoutRoomId: true });
    const { cm } = makeManager(FakeConn, {
      roomLookup: async () => ({ roomId: "7777777", viewers: 10, isLive: true }),
    });
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 30));

    const calls = created[0].connectCalls;
    assert.equal(calls.length, 2, "после неудачи была вторая попытка");
    assert.equal(calls[0].roomId, undefined, "сначала штатный путь");
    assert.equal(calls[1].roomId, "7777777", "затем комната из официального endpoint");
    cleanup(cm, entry);
  });

  await check("Офлайн-канал не пытается подключаться повторно с нашим roomId", async () => {
    const { FakeConn, created } = makeFakeConnection({ offline: true });
    const { cm } = makeManager(FakeConn, {
      roomLookup: async () => ({ roomId: "7777777", viewers: 0, isLive: false }),
    });
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(created[0].connectCalls.length, 1, "повторной попытки быть не должно");
    cleanup(cm, entry);
  });

  await check("Сообщение из эфира попадает в ленту", async () => {
    const { FakeConn, created } = makeFakeConnection();
    const { cm, chat } = makeManager(FakeConn);
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 20));

    created[0].emit("chat", { user: { nickname: "Аня", uniqueId: "anya" }, comment: "привет из тиктока" });
    const msg = chat.find((m) => m.platform === "tiktok" && !m.sys);
    assert.ok(msg, "сообщение дошло до ленты");
    assert.equal(msg.author, "Аня");
    assert.equal(msg.text, "привет из тиктока");
    cleanup(cm, entry);
  });

  await check("Смайлы канала разбираются в картинки", async () => {
    const { FakeConn, created } = makeFakeConnection();
    const { cm, chat } = makeManager(FakeConn);
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 20));

    created[0].emit("chat", {
      user: { nickname: "Костя" },
      comment: "ха X",
      emotes: [{ placeInComment: 3, emote: { image: { imageUrl: "https://cdn/emote.png" } } }],
    });
    const msg = chat.find((m) => m.author === "Костя");
    assert.ok(msg.parts?.some((p) => p.type === "emote"), "смайл распознан");
    assert.ok(msg.parts?.some((p) => p.type === "text" && p.value.includes("ха")), "текст сохранён");
    cleanup(cm, entry);
  });

  await check("Счётчик зрителей обновляется событием комнаты", async () => {
    const { FakeConn, created } = makeFakeConnection();
    const { cm } = makeManager(FakeConn);
    const entry = makeEntry();
    await cm._tiktok(entry);
    await new Promise((r) => setTimeout(r, 20));

    created[0].emit("roomUser", { viewerCount: 1234 });
    assert.equal(entry.viewers, 1234, "онлайн обновился");
    cleanup(cm, entry);
  });

  await check("Сторож тишины снимается вместе с каналом", async () => {
    assert.ok(source.includes("entry.silenceTimer"), "сторож тишины реализован");
    assert.ok(
      /_teardown\(entry\)[\s\S]{0,400}silenceTimer\) \{ clearTimeout/.test(source),
      "таймер очищается при остановке канала"
    );
  });

  console.log(`\n${passed} проверок TikTok пройдено.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
