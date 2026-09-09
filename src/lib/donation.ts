/**
 * DonationAlerts — подключается как обычный канал, но вместо username
 * используется секретный токен из профиля. Валюта настраивается отдельно.
 */

export const CURRENCIES = ["RUB", "USD", "EUR", "KZT", "UAH", "BYN", "TRY", "GEL", "PLN", "GBP"] as const;
export type DonationCurrency = (typeof CURRENCIES)[number];

/** Символ валюты для отображения рядом с суммой. */
export const CURRENCY_SYMBOL: Record<string, string> = {
  RUB: "₽", USD: "$", EUR: "€", KZT: "₸", UAH: "₴", BYN: "Br", TRY: "₺", GEL: "₾", PLN: "zł", GBP: "£",
};

/** Форматирует сумму доната: 1500 → «1 500», 1234.5 → «1 234,5». */
export function fmtAmount(n: number | null | undefined, currency?: string): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  const num = v.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  const sym = currency ? ` ${CURRENCY_SYMBOL[currency] ?? currency}` : "";
  return `${num}${sym}`;
}

/**
 * Пересчёт доната в выбранную валюту канала. Курс фиксированный и правится
 * в одном месте — DonationAlerts присылает суммы в валюте доната пользователя.
 */
export const RATES_TO_RUB: Record<string, number> = {
  RUB: 1, USD: 92, EUR: 100, KZT: 0.19, UAH: 2.3, BYN: 28, TRY: 2.7, GEL: 34, PLN: 23, GBP: 117,
};

export function convert(amount: number, from: string, to: string): number {
  const a = RATES_TO_RUB[from] ?? 1;
  const b = RATES_TO_RUB[to] ?? 1;
  if (!a || !b) return amount;
  return (amount * a) / b;
}

/** Текст события доната для ленты — единый шаблон для приложения и оверлея. */
export function donationMessage(opts: {
  username: string;
  amount: number;
  currency: string;
  message?: string;
  total?: number;
  targetCurrency?: string;
}): string {
  const { username, amount, currency, message, total, targetCurrency } = opts;
  const cur = targetCurrency || currency;
  const totalText = typeof total === "number" ? ` · всего за стрим ${fmtAmount(total, cur)}` : "";
  const msg = message?.trim() ? `: ${message.trim()}` : "";
  return `💖 ${username} донатит ${fmtAmount(amount, currency)}${totalText}${msg}`;
}
