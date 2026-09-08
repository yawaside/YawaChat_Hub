// Сетевой помощник для коннекторов.
//
// FIX(2.0.2): предыдущий вариант со скрытым окном Chromium + executeJavaScript
// в упакованном exe часто «висел» (страница robots.txt не догружалась, GPU/sandbox)
// и все запросы молча падали — из-за этого каналы всегда были в «ошибка».
//
// Теперь запросы идут через Electron `net` (модуль на базе сетевого стека Chromium):
//   - реальный User-Agent и заголовки браузера;
//   - общий partition-session, где сохраняются куки (нужно для YouTube consent/Kick);
//   - следование редиректам;
//   - таймауты и явные коды ошибок.
//
// `net` доступен только после app.whenReady() — до этого коннекторы не стартуют.
const { net, session } = require("electron");
const https = require("node:https");

/**
 * TLS для «сырых» соединений Node (WebSocket-коннекторы, Edge TTS).
 *
 * У части пользователей стоит антивирус или корпоративный прокси с
 * TLS-инспекцией: его корень добавлен в хранилище Windows, Chromium ему
 * доверяет, а «сырой» Node — нет, и соединения падали с
 * "unable to verify the first certificate".
 *
 * Решение (см. также main.js): для совместимости с инспекцией в main.js
 * включена глобальная NODE_TLS_REJECT_UNAUTHORIZED="0" — без неё чат-библиотеки
 * с собственными соединениями не подключаются вовсе. Здесь держим то же
 * поведение точечно для тех WebSocket, которыми управляем сами, а
 * installCertificateHandler страхует HTTP-запросы через Electron `net`.
 */
/** Ошибки, которыми антивирусная TLS-инспекция обычно ломает проверку цепочки. */
const INSPECTION_ERRORS = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
]);

/** Домены, чей публичный чат мы читаем. Всё остальное проверяется строго. */
const TRUSTED_SUFFIXES = [
  "twitch.tv", "ttvnw.net", "jtvnw.net",
  "kick.com", "pusher.com", "pusherapp.com",
  "youtube.com", "googlevideo.com", "ytimg.com", "google.com",
  "vkplay.live", "vkvideo.ru", "vk.com", "vkuserlive.com", "mycdn.me",
  "tiktok.com", "tiktokcdn.com", "byteoversea.com", "ibytedtos.com",
  "7tv.app", "betterttv.net", "frankerfacez.com",
  "microsoft.com", "bing.com", "azure.com", // Edge TTS
];

const isTrustedHost = (host) => {
  const name = String(host || "").toLowerCase().replace(/\.$/, "");
  return TRUSTED_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
};

/**
 * Агент строгой проверки — для ВСЕХ хостов вне списка чат-площадок:
 * обычный Node по умолчанию доверяет только системному хранилищу.
 */
const secureAgent = new https.Agent({ keepAlive: true, maxCachedSessions: 16 });

/**
 * Мягкий агент для чат-площадок (те же адреса, что в TRUSTED_SUFFIXES).
 * Ослабление применяется только к этим хостам; остальной трафик идёт через
 * строгий secureAgent. Глобальную настройку в main.js библиотеки обходят —
 * поэтому и она нужна, и эти агенты не мешают.
 */
const chatAgent = new https.Agent({
  keepAlive: true,
  maxCachedSessions: 16,
  rejectUnauthorized: false,
});

/**
 * Опции для `new WebSocket(url, opts)`.
 *   - чат-площадка      → мягкий агент (иначе у пользователей с антивирусом,
 *                         инспектирующим TLS, соединение не устанавливается);
 *   - любой другой хост → строгий агент.
 */
function tlsOptionsFor(url) {
  let host = "";
  try { host = new URL(String(url).replace(/^ws/, "http")).hostname; } catch { /* noop */ }
  if (isTrustedHost(host)) {
    return { agent: chatAgent };
  }
  return { agent: secureAgent };
}

/**
 * Разрешает ошибку сертификата для доверенного хоста, если она вызвана
 * локальной TLS-инспекцией. Ставится один раз из main.js.
 */
function installCertificateHandler(app) {
  app.on("certificate-error", (event, _webContents, url, error, _certificate, callback) => {
    let host = "";
    try { host = new URL(url).hostname; } catch { /* noop */ }
    const inspection = INSPECTION_ERRORS.has(String(error).replace(/^net::ERR_CERT_/, "")) ||
      /AUTHORITY_INVALID|COMMON_NAME_INVALID/i.test(String(error));
    if (isTrustedHost(host) && inspection) {
      debug(`[tls] доверяем ${host}: локальная инспекция (${error})`);
      event.preventDefault();
      callback(true);
      return;
    }
    callback(false); // все прочие ошибки — по-прежнему ошибка
  });
}


const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

let ses = null;
let debug = () => {};

function setDebug(fn) {
  debug = typeof fn === "function" ? fn : () => {};
}

function getSession() {
  if (!ses) {
    ses = session.fromPartition("persist:yawanet");
    ses.setUserAgent(UA);
    // притворяемся, что consent уже дан — YouTube без этого редиректит на consent.youtube.com
    try {
      ses.cookies.set({
        url: "https://www.youtube.com",
        name: "CONSENT",
        value: "YES+cb.20210328-17-p0.en+FX+" + Math.floor(Math.random() * 900 + 100),
        domain: ".youtube.com",
      });
      ses.cookies.set({
        url: "https://www.youtube.com",
        name: "SOCS",
        value: "CAI",
        domain: ".youtube.com",
      });
    } catch { /* noop */ }
  }
  return ses;
}

/**
 * HTTP-запрос через Chromium-стек Electron.
 * @returns {Promise<{ok:boolean,status:number,body:string,error?:string}>}
 */
function request(url, { method = "GET", headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };

    let req;
    try {
      req = net.request({
        method,
        url,
        session: getSession(),
        useSessionCookies: true,
        redirect: "follow",
      });
    } catch (e) {
      return finish({ ok: false, status: 0, body: "", error: String(e && e.message ? e.message : e) });
    }

    req.setHeader("User-Agent", UA);
    req.setHeader("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8");
    for (const [k, v] of Object.entries(headers)) {
      try { req.setHeader(k, v); } catch { /* noop */ }
    }

    const timer = setTimeout(() => {
      try { req.abort(); } catch { /* noop */ }
      finish({ ok: false, status: 0, body: "", error: "timeout" });
    }, timeout);

    req.on("response", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk.toString("utf8")));
      res.on("end", () =>
        finish({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: data })
      );
      res.on("error", (e) =>
        finish({ ok: false, status: res.statusCode || 0, body: data, error: String(e && e.message ? e.message : e) })
      );
    });
    req.on("error", (e) =>
      finish({ ok: false, status: 0, body: "", error: String(e && e.message ? e.message : e) })
    );

    if (body) {
      try { req.write(body); } catch { /* noop */ }
    }
    try { req.end(); } catch (e) {
      finish({ ok: false, status: 0, body: "", error: String(e && e.message ? e.message : e) });
    }
  });
}

async function getText(url, headers) {
  const r = await request(url, { headers });
  if (!r.ok) debug(`GET ${url} → ${r.status} ${r.error || ""}`.trim());
  return r.ok ? r.body : "";
}

async function getJson(url, headers) {
  const r = await request(url, { headers: { accept: "application/json", ...(headers || {}) } });
  if (!r.ok) {
    debug(`GET(json) ${url} → ${r.status} ${r.error || ""}`.trim());
    return null;
  }
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

async function postJson(url, data, headers) {
  const r = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers || {}) },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    debug(`POST ${url} → ${r.status} ${r.error || ""}`.trim());
    return null;
  }
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

function closeNet() {
  ses = null;
}

module.exports = {
  chatAgent,
  secureAgent,
  tlsOptionsFor,
  installCertificateHandler,
  isTrustedHost, request, getText, getJson, postJson, closeNet, setDebug, UA };
