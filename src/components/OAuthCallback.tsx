import { useEffect, useRef, useState } from "react";
import { Check, Home, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

/**
 * Страница-приёмник авторизации (redirect URI: https://yawachathub.netlify.app/).
 *
 * Twitch (как и VK) возвращают пользователя на этот сайт с токеном в адресе.
 * Здесь мы:
 *   1. читаем access_token и state (оба в фрагменте адреса);
 *   2. определяем площадку по префиксу state: twitch_ или vk_;
 *   3. НЕ показываем токен пользователю;
 *   4. передаём токен+state в локальный сервер приложения (127.0.0.1:17563);
 *   5. приложение само сверяет state и возвращает фокус в окно.
 *
 * Токен никогда не отображается на экране и не уходит никуда, кроме запущенного
 * приложения на этом компьютере.
 */

type OAuthPlatform = "twitch" | "vk";

const PLATFORM_TITLES: Record<OAuthPlatform, string> = {
  twitch: "Twitch",
  vk: "VK",
};

const BRIDGE_HOST = "http://127.0.0.1:17563";

/** Разбираем фрагмент/запрос: access_token, state, error. */
function parseCallbackUrl(hash: string, search: string) {
  const toMap = (raw: string) => {
    const out = new Map<string, string>();
    const clean = String(raw || "").replace(/^#/, "").replace(/^\?/, "");
    for (const part of clean.split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      if (i === -1) continue;
      try {
        out.set(decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1)));
      } catch { /* skip bad encoding */ }
    }
    return out;
  };
  const fromHash = toMap(hash);
  const fromQuery = toMap(search);
  const get = (k: string) => fromHash.get(k) || fromQuery.get(k) || "";
  const token = get("access_token") || get("token");
  const code = get("code");
  const state = get("state");
  const error = get("error") || get("error_description");
  // Площадка — по префиксу state (app шлёт «twitch.<rand>» или «vk.<rand>»).
  let platform: OAuthPlatform | null = null;
  if (state.startsWith("twitch.")) platform = "twitch";
  else if (state.startsWith("vk.")) platform = "vk";
  return { token, code, state, error, platform };
}

type Phase = "sending" | "ok" | "failed" | "error";

export default function OAuthCallback({ hash }: { hash: string }) {
  const [platform, setPlatform] = useState<OAuthPlatform>("twitch");
  const [phase, setPhase] = useState<Phase>("sending");
  const [errMsg, setErrMsg] = useState("");
  const sent = useRef(false);

  const deliver = (token: string, code: string, state: string, target: OAuthPlatform) => {
    if (sent.current) return;
    sent.current = true;
    setPlatform(target);
    setPhase("sending");
    fetch(`${BRIDGE_HOST}/auth/${target}`, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify({ token: token || undefined, code: code || undefined, state }),
      cache: "no-store",
    })
      .then(() => setPhase("ok"))
      .catch(() => setPhase("failed"));
    // Подстраховка: повтор через 1.2 с, если приложение ещё не проснулось.
    window.setTimeout(() => {
      if (sent.current && phase !== "ok") {
        fetch(`${BRIDGE_HOST}/auth/${target}`, {
          method: "POST",
          mode: "no-cors",
          body: JSON.stringify({ token: token || undefined, code: code || undefined, state }),
          cache: "no-store",
        }).catch(() => {});
      }
    }, 1200);
  };

  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const { token, code, state, error, platform: p } = parseCallbackUrl(hash, search);
    if (error) {
      setPhase("error");
      setErrMsg("Площадка вернула ошибку. Вернитесь в приложение и повторите вход.");
      return;
    }
    if ((!token && !code) || !p) {
      setPhase("failed");
      return;
    }
    deliver(token, code, state, p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  const title = PLATFORM_TITLES[platform];

  const backToApp = () => {
    // Возврат в приложение через кастомную схему yawachat://.
    window.location.href = "yawachat://oauth";
  };

  return (
    <div className="grid min-h-screen place-items-center bg-void px-6 py-12 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-[#8b5cf6] to-[#22d3ee] text-white shadow-lg">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h1 className="font-display text-lg font-bold leading-tight">Вход через {title}</h1>
            <p className="mt-0.5 font-mono text-[11px] text-white/50">YawaChatHub · безопасная авторизация</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {phase === "sending" && (
            <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-[13px] text-white/75">
              <Loader2 size={16} className="animate-spin" /> Передаём токен в YawaChatHub…
            </div>
          )}
          {phase === "ok" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-[13px] text-emerald-200">
                <Check size={16} /> Готово! Фокус вернулся в приложение — {title} подключён.
              </div>
              <p className="text-[12px] leading-relaxed text-white/45">
                Токен автоматически перенесён в YawaChatHub и зашифрован. Эту вкладку можно закрыть.
              </p>
              <button
                type="button"
                onClick={backToApp}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#22d3ee] px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg transition-transform hover:scale-[1.01]"
              >
                <Home size={15} /> Вернуться в YawaChatHub
              </button>
            </div>
          )}
          {phase === "failed" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[13px] text-amber-100">
                YawaChatHub не отвечает или токен не получен.
              </div>
              <p className="text-[12px] leading-relaxed text-white/45">
                Убедитесь, что приложение запущено, и повторите вход.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={backToApp}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-[13px] font-semibold transition-colors hover:border-white/40">
                  <Home size={15} /> Вернуться в приложение
                </button>
                <button type="button" onClick={() => window.location.reload()}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-[13px] font-semibold transition-colors hover:border-white/40">
                  <RefreshCw size={15} /> Повторить
                </button>
              </div>
            </div>
          )}
          {phase === "error" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-[13px] text-red-100">{errMsg}</div>
              <button type="button" onClick={backToApp}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-[13px] font-semibold transition-colors hover:border-white/40">
                <Home size={15} /> Вернуться в приложение
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-white/35">
          Токен не показывается и никуда, кроме запущенного приложения на этом компьютере, не отправляется.
        </p>
      </div>
    </div>
  );
}
