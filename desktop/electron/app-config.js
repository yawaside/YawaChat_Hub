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
   * Redirect URL — зарегистрирован в Twitch и VK при создании приложений.
   * После выдачи прав площадка возвращает пользователя на этот адрес,
   * страница сайта передаёт токен запущенному приложению на 127.0.0.1:17563
   * и фокус возвращается в окно приложения.
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
    ],
  },

  /* ---------------- VK ID ---------------- */
  vk: {
    /** ID приложения из dev.vk.com/ru/admin */
    clientId: "54759783",
    /**
     * Защищённый ключ никогда не попадает в исходники или exe.
     * OAuth implicit flow, который использует desktop-клиент, его не требует.
     * Для будущих server-side проверок ключ передаётся только через окружение CI.
     */
    clientSecret: process.env.VK_CLIENT_SECRET || "",
    // Классические права Standalone. Префикс vkuapi.* даёт Security Error на oauth.vk.com.
    scopes: ["offline"],
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
