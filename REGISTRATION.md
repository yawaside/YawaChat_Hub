# Мини-инструкция: что поменять в коде перед сборкой

**Решение уже готово «под ключ»** — все ключи вписаны, пользователь скачивает exe,
открывает «Каналы → Чат-бот», нажимает «Войти» (Twitch/VK), разрешает доступ в браузере —
и сразу получает модерацию и события стрима. Ничего дополнительно настраивать не нужно.

**Единственный файл, который может понадобиться поменять — `desktop/electron/app-config.js`**
(если ключ отзовут или создадут новое приложение). Остальное (код, интерфейс, логика) трогать не надо.

---

## 1. Redirect URL — один на обе площадки

```
https://yawachathub.netlify.app/
```

Указывается и в Twitch, и в VK. Отдельный redirect для приложения не нужен:
сайт принимает возврат пользователя, читает токен из адреса и **пересылает его
в приложение** на `http://127.0.0.1:17563` (см. `src/components/OAuthCallback.tsx`
и `startOAuthServer` в `desktop/electron/main.js`).

---

## 2. Twitch

1. Откройте <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. Поля:
   - **Name** — уникальное, например `YawaChatHub`;
   - **OAuth Redirect URL** — `https://yawachathub.netlify.app/`;
   - **Category** — `Chat Bot`.
3. Скопируйте **Client ID** → в `app-config.js`:

```js
twitch: {
  clientId: "3qcjmtqkoobdcrrxzqbcw75n7egr8n",
  clientSecret: "",
  scopes: ["chat:read", "chat:edit", "moderator:manage:chat_messages",
           "moderator:manage:banned_users", "moderator:read:followers",
           "channel:read:subscriptions", "user:read:chat"],
},
```

`clientSecret` нужен только для server-side проверок — оставьте пустым,
implicit flow его не использует.

---

## 3. VK ID

1. Откройте <https://dev.vk.com/ru/admin> → **Мои приложения** → создать **Standalone-приложение**.
2. В настройках укажите **Redirect URI**: `https://yawachathub.netlify.app/`.
3. Скопируйте **ID приложения** и **Защищённый ключ**:

```js
vk: {
  clientId: "54759783",
  clientSecret: "8ebrEvDXbo85leZftJHz",
  scopes: ["vkuapi.im", "vkuapi.video", "vkuapi.users", "vkuapi.groups"],
},
```

---

## 4. DonationAlerts

```js
donationAlerts: {
  webhookPath: "/da-webhook",
  webhookPort: 17564,
  webhookSecret: "",        // секрет вебхука, если он задан в кабинете D.A.
  defaultCurrency: "RUB",   // меняется и в интерфейсе
},
```

DonationAlerts подключается **как обычный канал**: в панели «Каналы» выберите
иконку D.A., вставьте **секретный токен** из профиля
(<https://www.donationalerts.com/account/settings/api-access>) и выберите валюту.

После этого:

- донат приходит **событием в общую ленту**;
- DonationAlerts отображается **в оверлее как подключённая площадка** вместе с
  Twitch/VK/YouTube, но вместо зрителей показывает **общую сумму донатов за стрим**
  в выбранной валюте.

---

## 5. Как работает авторизация (чтобы ничего не менять руками)

1. В панели «Каналы» → **Чат-бот** нажимаете «Войти» напротив площадки.
2. Открывается **браузер по умолчанию** с экраном разрешения Twitch/VK.
3. После разрешения браузер возвращается на `https://yawachathub.netlify.app/`.
4. Страница сайта берёт `access_token` из адреса и передаёт его приложению
   (`http://127.0.0.1:17563/auth/<платформа>?access_token=…`).
5. Приложение **само** запрашивает аккаунт и канал через API — **ник вводить не нужно**.
6. Если приложение не запущено, страница показывает токен с кнопкой «Копировать».

---

## 6. Сборка

```bash
npm install
npm run build              # сайт (Next.js) — тот, что на yawachathub.netlify.app
npm run build:renderer     # интерфейс приложения → desktop/renderer-dist
cd desktop && npm install && npm run dist:all
```

И просто пуш в `main` — релиз соберёт GitHub Actions.

---

## 7. Что проверять после сборки

| Проверка | Где |
| --- | --- |
| Кнопка «Войти» открывает браузер | Каналы → Чат-бот |
| После входа канал определился сам | Каналы → Чат-бот (строка площадки) |
| Донат попадает в ленту | Каналы → DonationAlerts |
| Сумма донатов в оверлее | Оверлей → строка онлайна площадок |
| Модерация по клику на ник | Лента → клик по нику |
| Команды бота | Настройки → Чат-бот |
| Настройка событий | Настройки → Лента → События в ленте |
