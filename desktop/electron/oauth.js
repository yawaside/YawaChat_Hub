// Безопасный вход Twitch / VK прямо в приложение.
//
// Браузер системный не используется как «сайт-редирект»: открывается окно
// Electron, после разрешения площадки токен перехватывается из адреса
// (hash/query) и окно сразу закрывается. Токен не уходит на внешний сайт.
const { BrowserWindow } = require("electron");
const crypto = require("crypto");

function parseCallback(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || "")); } catch { return null; }
  const hash = String(u.hash || "").replace(/^#/, "");
  const hp = new URLSearchParams(hash);
  const qp = u.searchParams;
  const token = hp.get("access_token") || qp.get("access_token") || "";
  const error = hp.get("error") || qp.get("error") || "";
  const errorDescription = hp.get("error_description") || qp.get("error_description") || "";
  const state = hp.get("state") || qp.get("state") || "";
  return {
    href: u.href,
    host: u.hostname,
    path: u.pathname,
    token: token.replace(/^oauth:/, ""),
    error,
    errorDescription,
    state,
  };
}

function isTwitchReturn(info) {
  return info && (info.host === "localhost" || info.host === "127.0.0.1");
}

function isVkReturn(info) {
  return info && /oauth\.vk\.(com|ru)$/i.test(info.host) && /blank\.html$/i.test(info.path);
}

function authorizeInApp({ platform, clientId, scopes, parent }) {
  return new Promise((resolve, reject) => {
    const id = String(clientId || "").trim();
    if (!id) {
      reject(new Error(platform === "vk" ? "Не задан ID приложения VK" : "Не задан Client ID Twitch"));
      return;
    }

    const state = `${platform}.${crypto.randomBytes(12).toString("hex")}`;
    let url = "";
    if (platform === "twitch") {
      const redirect = "http://localhost";
      url = `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(id)}`
        + `&redirect_uri=${encodeURIComponent(redirect)}`
        + `&response_type=token`
        + `&scope=${encodeURIComponent((scopes || []).join(" "))}`
        + `&state=${encodeURIComponent(state)}`
        + `&force_verify=true`;
    } else if (platform === "vk") {
      // Standalone-приложение VK принимает только blank.html. Чужой redirect
      // (в том числе сайт) даёт {"error":"invalid_request","error_description":"Security Error"}.
      const redirect = "https://oauth.vk.com/blank.html";
      url = `https://oauth.vk.com/authorize?client_id=${encodeURIComponent(id)}`
        + `&display=page`
        + `&redirect_uri=${encodeURIComponent(redirect)}`
        + `&scope=${encodeURIComponent((scopes || []).join(","))}`
        + `&response_type=token`
        + `&v=5.199`
        + `&state=${encodeURIComponent(state)}`;
    } else {
      reject(new Error("Неизвестная площадка"));
      return;
    }

    const win = new BrowserWindow({
      width: 520,
      height: 740,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: false,
      show: true,
      autoHideMenuBar: true,
      title: platform === "twitch" ? "Вход через Twitch" : "Вход через VK",
      backgroundColor: "#0b0d16",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    win.setMenuBarVisibility(false);

    let settled = false;
    const finish = (err, token) => {
      if (settled) return;
      settled = true;
      try { if (!win.isDestroyed()) win.close(); } catch { /* noop */ }
      if (err) reject(err);
      else resolve(token);
    };

    const capture = (navUrl) => {
      const info = parseCallback(navUrl);
      if (!info) return false;
      const ours = platform === "twitch" ? isTwitchReturn(info) : isVkReturn(info);
      if (!ours) return false;
      if (info.error) {
        finish(new Error(info.errorDescription || info.error));
        return true;
      }
      if (info.token) {
        finish(null, info.token);
        return true;
      }
      return false;
    };

    const onNav = (event, navUrl) => {
      if (capture(navUrl)) {
        try { event.preventDefault(); } catch { /* noop */ }
      }
    };
    win.webContents.on("will-redirect", onNav);
    win.webContents.on("will-navigate", onNav);
    win.webContents.on("did-navigate", (_e, navUrl) => { capture(navUrl); });
    win.webContents.on("did-navigate-in-page", (_e, navUrl) => { capture(navUrl); });
    win.webContents.on("did-fail-load", () => { capture(win.webContents.getURL()); });
    win.webContents.on("did-finish-load", () => { capture(win.webContents.getURL()); });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => finish(new Error("Авторизация отменена")));

    win.loadURL(url).catch((error) => finish(error));
  });
}

module.exports = { authorizeInApp, parseCallback };
