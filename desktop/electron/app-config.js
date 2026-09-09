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
   * Desktop-вход больше не идёт через сайт: Twitch возвращает токен на
   * http://localhost внутри окна приложения, VK — на oauth.vk.com/blank.html
   * (требование Standalone). Поле оставлено для документации сайта.
   */
  redirectUrl: "https://yawachathub.netlify.app/",

  /* ---------------- Twitch ---------------- */
  twitch: {
    /** Client ID из dev.twitch.tv/console/apps */
    clientId: "3qcjmtqkoobdcrrxzqbcw75n7egr8n",
    /** Client Secret (New Secret) — нужен для проверки токена и app-access запросов. */
    clientSecret: "",
    /** Scopes: чтение/отправка чата, модерация, подписки и отслеживания. */
    scopes: [
      "chat:read",
      "chat:edit",
      "moderator:manage:chat_messages",
      "moderator:manage:banned_users",
      "moderator:read:followers",
      "channel:read:subscriptions",
      "user:read:chat",
      // EventSub: награды за баллы, опросы, прогнозы, поезда поддержки, цели.
      "channel:read:redemptions",
      "channel:read:polls",
      "channel:read:predictions",
      "channel:read:hype_train",
      "channel:read:goals",
    ],
  },

  /* ---------------- VK ID (id.vk.com) ----------------
   * Приложение 54759783 выдаёт «Защищённый ключ» — значит, это VK ID-приложение.
   * Для VK ID НЕ работает старый oauth.vk.com (Security Error): авторизация идёт
   * через https://id.vk.com/authorize (authorization code flow), а код обменивается
   * на токен по https://id.vk.com/oauth2/auth с client_secret.
   */
  vk: {
    /** ID приложения VK ID из dev.vk.com/ru/admin */
    clientId: "54759783",
    /** Защищённый ключ VK ID — нужен для обмена code на access_token. */
    clientSecret: "8ebrEvDXbo85leZftJHz",
    /** Права VK ID: offline — «вечный» токен; пользователь канала узнаётся через users.get. */
    scopes: ["offline"],
    /** Единый вход VK ID. */
    authorizeUrl: "https://id.vk.com/authorize",
    /** Обмен кода на токен. */
    tokenUrl: "https://id.vk.com/oauth2/auth",
    /** Версия API VK. */
    apiVersion: "5.199",
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
