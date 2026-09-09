import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, HeartHandshake } from "lucide-react";

/**
 * Страница-приёмник авторизации.
 *
 * Площадки (Twitch, VK) возвращают пользователя на https://yawachathub.netlify.app/
 * с токеном в адресной строке: `#access_token=…&scope=…` (implicit flow).
 *
 * Фрагмент адреса не доходит до сервера, поэтому передать его напрямую нельзя:
 * страница читает токен на клиенте и пересылает в YawaChatHub запросом на
 * http://127.0.0.1:17563/auth/<платформа>?access_token=… — там его ждёт
 * локальный мост (startOAuthServer в desktop/electron/main.js).
 *
 * Если приложение не запущено, токен показывается на экране с кнопкой
 * «Скопировать», чтобы можно было вставить его вручную.
 */

type OAuthPlatform = "twitch" | "vk";

const PLATFORM_TITLES: Record<OAuthPlatform, string> = {
  twitch: "Twitch",
  vk: "VK",
};

const BRIDGE_PORT = 17563;

export default function OAuthCallback({ hash }: { hash: string }) {
  const [platform, setPlatform] = useState<OAuthPlatform>("twitch");
  const [token, setToken] = useState("");
  const [state, setState] = useState<"sending" | "ok" | "failed">("sending");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new Map<string, string>();
    const clean = String(hash || "").replace(/^#/, "");
    for (const part of clean.split("&")) {
      const i = part.indexOf("=");
      if (i === -1) continue;
      params.set(decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1)));
    }
    const t = params.get("access_token") || "";
    const fromQuery = new URLSearchParams(window.location.search);
    const p = (fromQuery.get("platform") as OAuthPlatform) || (/twitch/i.test(window.location.search) ? "twitch" : "vk");
    setPlatform(p in PLATFORM_TITLES ? p : "twitch");
    setToken(t);
    if (!t) {
      setState("failed");
      return;
    }
    let cancelled = false;
    // Токен уходит в приложение; фрагмент пересылаем как query-параметр.
    fetch(`http://127.0.0.1:${BRIDGE_PORT}/auth/${p}?access_token=${encodeURIComponent(t)}`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    })
      .then(() => { if (!cancelled) setState("ok"); })
      .catch(() => { if (!cancelled) setState("failed"); });
    // Подстраховка: повторная попытка через секунду (приложение могло ещё не проснуться).
    const retry = window.setTimeout(() => {
      if (cancelled || state === "ok") return;
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/auth/${p}?access_token=${encodeURIComponent(t)}`, { mode: "no-cors" }).catch(() => {});
    }, 1200);
    return () => { cancelled = true; window.clearTimeout(retry); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard может быть недоступен */ }
  };

  const title = PLATFORM_TITLES[platform];

  return (
    <div className="grid min-h-screen place-items-center bg-void px-6 py-12 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#22d3ee] text-white shadow-lg">
            <HeartHandshake size={20} />
          </span>
          <div>
            <h1 className="font-display text-lg font-bold leading-tight">Авторизация {title}</h1>
            <p className="mt-0.5 font-mono text-[11px] text-white/50">YawaChatHub · мост токена</p>
          </div>
        </div>

        {!token ? (
          <p className="mt-6 text-[13px] leading-relaxed text-white/70">
            В адресе нет <code className="text-white/90">access_token</code>. Вернитесь в YawaChatHub
            и нажмите «Войти» ещё раз.
          </p>
        ) : (
          <>
            <div className="mt-6 space-y-3 text-[13px] leading-relaxed">
              {state === "sending" && <p className="text-white/70">Передаём токен в YawaChatHub…</p>}
              {state === "ok" && (
                <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-2.5 text-emerald-200">
                  Готово! {title} подключён — вернитесь в приложение, канал определится автоматически.
                </p>
              )}
              {state === "failed" && (
                <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-amber-100">
                  Приложение не отвечает. Скопируйте токен и вставьте его в YawaChatHub вручную.
                </p>
              )}
            </div>

            <div className="mt-5">
              <div className="mb-1.5 text-[11px] text-white/50">Токен доступа</div>
              <div className="flex items-center gap-2">
                <code className="scroll-thin min-h-10 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[11.5px] text-white/80">
                  {token}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-[11.5px] font-semibold transition-colors hover:border-white/40"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                Токен не сохраняется на сайте и никуда не отправляется, кроме запущенного
                приложения на этом компьютере.
              </p>
            </div>
          </>
        )}

        <a
          href="/"
          className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white/60 transition-colors hover:text-white"
        >
          <ExternalLink size={12} /> На главную YawaChatHub
        </a>
      </div>
    </div>
  );
}
