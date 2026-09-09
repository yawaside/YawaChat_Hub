/**
 * События ленты — полный каталог всего, что YawaChatHub может показать в чате.
 *
 * Настройки живут в `chatView.events` (раздел «Лента» → «События в ленте»).
 * Каждое событие включается отдельно; `kind` пишется в сообщение коннекторами
 * и чат-ботом (`ChatMsg.kind`), поэтому фильтр работает и для реального чата,
 * и для событий подключения/донатов.
 */

export interface FeedEventMeta {
  id: string;
  label: string;
  desc: string;
  group: "chat" | "bot" | "moderation" | "stream" | "donation" | "system";
  /** включено по умолчанию */
  def: boolean;
}

export const FEED_EVENT_GROUPS: Array<{ id: FeedEventMeta["group"]; label: string }> = [
  { id: "chat", label: "Чат площадок" },
  { id: "bot", label: "Чат-бот" },
  { id: "donation", label: "Донаты" },
  { id: "moderation", label: "Модерация" },
  { id: "stream", label: "Трансляция" },
  { id: "system", label: "Система" },
];

/** Максимально полный список событий — по одному на каждую строку ленты. */
export const FEED_EVENTS: FeedEventMeta[] = [
  /* --- чат площадок --- */
  { id: "chat.message", label: "Сообщения зрителей", desc: "Обычные сообщения чата", group: "chat", def: true },
  { id: "chat.command", label: "Команды viewers (!…)", desc: "Сообщения, начинающиеся с !", group: "chat", def: true },
  { id: "chat.reply", label: "Ответы (reply)", desc: "Ответы на сообщения", group: "chat", def: true },
  { id: "chat.mention", label: "Упоминания автора", desc: "Сообщения, где упомянут стример или бот", group: "chat", def: true },
  { id: "chat.link", label: "Сообщения со ссылками", desc: "Ссылки и приглашения", group: "chat", def: true },
  { id: "chat.emote", label: "Только смайлы", desc: "Сообщения из одних эмодзи", group: "chat", def: true },
  { id: "chat.first", label: "Первое сообщение", desc: "Зритель пишет впервые", group: "chat", def: true },
  { id: "chat.highlighted", label: "Выделенные сообщения", desc: "Highlight / paid message", group: "chat", def: true },
  { id: "chat.whisper", label: "Личные сообщения", desc: "Whisper боту", group: "chat", def: false },

  /* --- чат-бот --- */
  { id: "bot.command", label: "Ответы бота на команды", desc: "Сработавшие команды из настроек", group: "bot", def: true },
  { id: "bot.unknown", label: "Неизвестные команды", desc: "Команда не найдена", group: "bot", def: false },
  { id: "bot.cooldown", label: "Кулдаун команды", desc: "Команда сработала слишком часто", group: "bot", def: false },
  { id: "bot.join", label: "Бот зашёл в чат", desc: "Подключение бота к каналу", group: "bot", def: true },
  { id: "bot.leave", label: "Бот покинул чат", desc: "Отключение бота", group: "bot", def: true },

  /* --- донаты --- */
  { id: "donation.alert", label: "Донат", desc: "Основное событие DonationAlerts", group: "donation", def: true },
  { id: "donation.goal", label: "Цель сбора", desc: "Прогресс и достижение цели", group: "donation", def: true },
  { id: "donation.total", label: "Сумма за стрим", desc: "Итоговая сумма по каналу", group: "donation", def: true },
  { id: "donation.top", label: "Топ донатеров", desc: "Смена лидера сбора", group: "donation", def: true },
  { id: "donation.token", label: "Подключение DonationAlerts", desc: "Статус токена и вебхука", group: "donation", def: true },

  /* --- модерация --- */
  { id: "mod.ban", label: "Бан", desc: "Постоянная блокировка зрителя", group: "moderation", def: true },
  { id: "mod.unban", label: "Разбан", desc: "Снятие блокировки", group: "moderation", def: true },
  { id: "mod.timeout", label: "Таймаут", desc: "Временная блокировка", group: "moderation", def: true },
  { id: "mod.delete", label: "Удаление сообщения", desc: "Сообщение удалено модератором", group: "moderation", def: true },
  { id: "mod.clear", label: "Очистка чата", desc: "Чат очищен модератором", group: "moderation", def: true },
  { id: "mod.slow", label: "Медленный режим", desc: "Ограничение частоты сообщений", group: "moderation", def: false },
  { id: "mod.emoteonly", label: "Режим только смайлы", desc: "Emote-only", group: "moderation", def: false },
  { id: "mod.followers", label: "Режим подписчиков", desc: "Чат только для подписчиков", group: "moderation", def: false },
  { id: "mod.subscribers", label: "Режим субов", desc: "Чат только для субов", group: "moderation", def: false },
  { id: "mod.raid", label: "Рейд", desc: "Наплыв зрителей из другого канала", group: "moderation", def: true },
  { id: "mod.warning", label: "Предупреждение", desc: "Предупреждение от модератора", group: "moderation", def: true },

  /* --- трансляция --- */
  { id: "stream.online", label: "Стрим начался", desc: "Трансляция в эфире", group: "stream", def: true },
  { id: "stream.offline", label: "Стрим закончился", desc: "Трансляция завершена", group: "stream", def: true },
  { id: "stream.title", label: "Смена названия", desc: "Новый заголовок стрима", group: "stream", def: true },
  { id: "stream.category", label: "Смена категории", desc: "Новая игра / категория", group: "stream", def: true },
  { id: "stream.viewers", label: "Мilestone онлайна", desc: "Круглые числа зрителей", group: "stream", def: false },
  { id: "stream.connect", label: "Канал подключён", desc: "YawaChatHub подключил канал", group: "stream", def: true },
  { id: "stream.disconnect", label: "Канал отключён", desc: "YawaChatHub отключил канал", group: "stream", def: true },
  { id: "stream.error", label: "Ошибка подключения", desc: "Канал упал с ошибкой", group: "stream", def: true },

  /* --- система --- */
  { id: "sys.follow", label: "Новый подписчик (follow)", desc: "Отслеживание Twitch/VK", group: "system", def: true },
  { id: "sys.subscribe", label: "Оформил подписку (sub)", desc: "Платная подписка", group: "system", def: true },
  { id: "sys.resub", label: "Продлил подписку", desc: "Продление подписки", group: "system", def: true },
  { id: "sys.subgift", label: "Подарил подписку", desc: "Gift sub", group: "system", def: true },
  { id: "sys.submystery", label: "Раздача подписок", desc: "Community sub", group: "system", def: true },
  { id: "sys.cheer", label: "Биты (cheer)", desc: "Поддержка битами", group: "system", def: true },
  { id: "sys.reward", label: "Награда канала", desc: "Сработал channel point reward", group: "system", def: true },
  { id: "sys.cheermote", label: "Платный смайл", desc: "Cheermote в сообщении", group: "system", def: false },
  { id: "sys.poll", label: "Опрос", desc: "Начало/конец опроса", group: "system", def: false },
  { id: "sys.prediction", label: "Прогноз", desc: "Prediction", group: "system", def: false },
  { id: "sys.hype", label: "Hype train", desc: "Поезд поддержки", group: "system", def: true },
  { id: "sys.announcement", label: "Объявление", desc: "Announcement модератора", group: "system", def: true },
  { id: "sys.extended", label: "Расширенное сообщение", desc: "Extended chat message", group: "system", def: false },
  { id: "sys.app", label: "Служебные сообщения приложения", desc: "Статус запуска, сети, обновлений", group: "system", def: true },
];

export type FeedEventState = Record<string, boolean>;

export const DEFAULT_FEED_EVENTS: FeedEventState = FEED_EVENTS.reduce<FeedEventState>((acc, e) => {
  acc[e.id] = e.def;
  return acc;
}, {});

/** Дополняет сохранённый набор новыми событиями после обновления приложения. */
export function normalizeFeedEvents(state: FeedEventState | undefined): FeedEventState {
  const out: FeedEventState = { ...DEFAULT_FEED_EVENTS };
  if (state && typeof state === "object") {
    for (const e of FEED_EVENTS) {
      if (typeof state[e.id] === "boolean") out[e.id] = state[e.id];
    }
  }
  return out;
}

/**
 * Пропускать ли сообщение. Обычные сообщения чата без `kind` всегда показываются,
 * если включено «Сообщения зрителей».
 */
export function isEventShown(state: FeedEventState | undefined, kind?: string): boolean {
  if (!kind) return state ? state["chat.message"] !== false : true;
  return state ? state[kind] !== false : true;
}

/** Все включённые события — для предпросмотра и отладки. */
export function enabledEvents(state: FeedEventState | undefined): FeedEventMeta[] {
  const s = normalizeFeedEvents(state);
  return FEED_EVENTS.filter((e) => s[e.id]);
}
