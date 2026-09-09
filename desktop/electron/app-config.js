/**
 * ============================================================
 *  YawaChatHub — РЕГИСТРАЦИЯ ПРИЛОЖЕНИЙ (единственный файл для правки)
 * ============================================================
 *  Что менять перед сборкой — ТОЛЬКО этот файл. Всё остальное не трогаем.
 *
 *  1. Twitch   — https://dev.twitch.tv/console/apps
 *  2. VK ID    — https://dev.vk.com/ru/admin
 *  3. DonationAlerts — https://www.donationalerts.com/account/settings/api-access
 *
 *  Redirect URL для обеих площадок ОДИНАКОВЫЙ: https://yawachathub.netlify.app/
 *  (сайт сам перешлёт токен в приложение — см. src/App.tsx → OAuthCallback).
 *
 *  Значения ниже уже вписаны; если ключ отзовут — замените и пересоберите.
 * ============================================================
 */
const APP_CONFIG = {
  /**
   * Redirect URI — ОДИН и тот же адрес для Twitch и VK, зарегистрированный
   * в настройках обоих приложений. Возврат идёт через системный браузер:
   * площадка редиректит на этот сайт → сайт передаёт данные локальному
   * серверу приложения (127.0.0.1:17563) → приложение получает фокус.
   * Twitch не поддерживает custom-схемы (yawachat://) в redirect_uri —
   * только http(s), поэтому используется сайт-посредник.
   */
  redirectUrl: "https://yawachathub.netlify.app/",

  /* ---------------- Twitch ---------------- */
  twitch: {
    /** Client ID из dev.twitch.tv/console/apps */
    clientId: "3qcjmtqkoobdcrrxzqbcw75n7egr8n",
    /** Client Secret (New Secret) — нужен для проверки токена и app-access запросов. */
    clientSecret: "",
    /** Scopes: чтение/отправка чата, модерация, подписки, награды за баллы, биты, рейды, хайп-трейн. */
    scopes: [
      "chat:read",
      "chat:edit",
      "moderator:manage:chat_messages",
      "moderator:manage:banned_users",
      "moderator:read:followers",
      "channel:read:subscriptions",
      "channel:read:redemptions",
      "channel:read:hype_train",
      "channel:read:polls",
      "channel:read:predictions",
      "bits:read",
      "user:read:chat",
    ],
  },

  /* ---------------- VK ID (OAuth 2.1 + PKCE) ----------------
   * VK полностью отключил старый implicit-flow (oauth.vk.com?response_type=token)
   * для новых приложений — он всегда отдаёт {"error":"invalid_request",
   * "error_description":"Security Error"}. Актуальная и единственная рабочая
   * схема — OAuth 2.1 Authorization Code + PKCE через домен id.vk.ru:
   *   1) GET  https://id.vk.ru/authorize?response_type=code&code_challenge=…
   *   2) редирект на redirect_uri с ?code=…&state=…&device_id=…
   *   3) POST https://id.vk.ru/oauth2/auth с code_verifier — обмен на access_token
   * См. https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description
   */
  vk: {
    /** ID приложения из dev.vk.com/ru/admin (Standalone-приложение) */
    clientId: "54759783",
    /**
     * Защищённый ключ никогда не попадает в исходники или exe.
     * PKCE делает client_secret ненужным для обмена кода на токен —
     * поле оставлено только для будущих server-side сценариев.
     */
    clientSecret: process.env.VK_CLIENT_SECRET || "",
    // offline — refresh-token для долгоживущей сессии; vkid.personal_info — имя/аватар,
    // чтобы user_info вернул аккаунт (раньше с одним offline user_info мог быть пустым).
    scopes: ["offline", "vkid.personal_info"],
  },

  /* ---------------- DonationAlerts ---------------- */
  donationAlerts: {
    /** Локальный вебхук (используется, если донаты идут напрямую в приложение). */
    webhookPath: "/da-webhook",
    webhookPort: 17564,
    /** Секрет вебхука из кабинета D.A. (пусто — подпись не проверяется). */
    webhookSecret: "",
    apiBase: "https://www.donationalerts.com/api/v1",
    socketUrl: "wss://socket.donationalerts.ru/socket.io/?EIO=3&transport=websocket",
    /** Валюта канала по умолчанию — меняется в интерфейсе. */
    defaultCurrency: "RUB",
  },

  /** Локальный сервер, который принимает токен со страницы сайта. */
  oauthBridge: {
    host: "127.0.0.1",
    port: 17563,
  },
};

module.exports = { APP_CONFIG };
