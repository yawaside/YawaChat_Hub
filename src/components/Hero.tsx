import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { PlatformIcon } from "./bits";
import { PLATFORM_LIST } from "../lib/core";
import type { PlatformId } from "../lib/core";
import { APP_TAG, APP_VERSION } from "../version";

const RELEASE = "https://github.com/yawaside/Yawachat.test/releases/latest";

/* сообщения для «живой» бегущей ленты */
const RIBBON: Array<{ p: PlatformId; a: string; t: string; c: string }> = [
  { p: "twitch", a: "neon_wolf", t: "ЛЕЕЕЕТС ГОООУ", c: "#a78bfa" },
  { p: "youtube", a: "LofiRadio", t: "какой трек сейчас играет?", c: "#f472b6" },
  { p: "kick", a: "cyber_arena", t: "кик грузит быстрее всех, факт", c: "#4ade80" },
  { p: "tiktok", a: "@yawa.live", t: "приветики из тиктока", c: "#ff8fa3" },
  { p: "vk", a: "КиберДед", t: "смотрю третий год, респект", c: "#74c0fc" },
  { p: "twitch", a: "pixel_lisa", t: "gg wp, красиво забрал раунд", c: "#ffd43b" },
  { p: "youtube", a: "mila_lav", t: "привет из чата, как настроение?", c: "#63e6be" },
  { p: "kick", a: "vanya_fps", t: "модератор молодец", c: "#9775fa" },
  { p: "tiktok", a: "luna228", t: "пошёл за чаем, не скучайте", c: "#ffa94d" },
  { p: "vk", a: "vklive.cyber", t: "залетаю со всех площадок сразу", c: "#e599f7" },
];

const ease = [0.22, 1, 0.36, 1] as const;

/** Бесшовная горизонтальная лента сообщений. */
function Ribbon({ reverse = false, duration = 36 }) {
  return (
    <div className="overflow-hidden border-y border-white/[0.07] bg-white/[0.015] py-3.5 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div
        className="flex w-max animate-marquee-x"
        style={{ animationDuration: `${duration}s`, animationDirection: reverse ? "reverse" : "normal" }}
      >
        {[0, 1].map((half) => (
          <div key={half} className="flex items-center gap-10 pr-10">
            {RIBBON.map((m, i) => (
              <span key={i} className="inline-flex items-center gap-2 whitespace-nowrap">
                <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px]" style={{ color: m.c, background: `${m.c}18` }}>
                  <PlatformIcon id={m.p} size={11} />
                </span>
                <span className="text-[12.5px] font-bold" style={{ color: m.c }}>{m.a}</span>
                <span className="text-[12.5px] text-white/40">{m.t}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section id="top" className="relative overflow-hidden pt-40 sm:pt-48">
      {/* фон */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="grid-bg absolute inset-0 opacity-35 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent)]" />
        <div className="absolute left-1/2 top-[-200px] h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-viol/[0.16] blur-[140px]" />
      </div>

      <div className="mx-auto max-w-6xl px-6 text-center">
        {/* бейдж */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
        >
          <span className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-2 pr-4 text-[11px] text-white/50">
            <span className="rounded-full bg-viol px-2 py-0.5 font-mono text-[10px] font-bold text-white">NEW</span>
            версия {APP_VERSION} · portable · Windows x64
          </span>
        </motion.div>

        {/* гигантский заголовок */}
        <motion.h1
          initial={{ opacity: 0, y: 34 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.85, delay: 0.08, ease }}
          className="mt-10 font-display font-extrabold leading-[0.95] tracking-tight"
        >
          <span className="block text-[clamp(2.6rem,8.5vw,7rem)] text-white">ОДИН ЧАТ.</span>
          <span className="text-stroke block text-[clamp(2.6rem,8.5vw,7rem)]">ВСЕ ПЛОЩАДКИ.</span>
          <span className="block bg-gradient-to-r from-viol via-[#c4b5fd] to-cy bg-clip-text text-[clamp(1.5rem,4.2vw,3.4rem)] text-transparent">
            с живой голосовой озвучкой
          </span>
        </motion.h1>

        {/* подпись */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.18, ease }}
          className="mx-auto mt-8 max-w-xl text-[15.5px] leading-relaxed text-white/45"
        >
          Сообщения с пяти платформ стриминга собираются в единый поток,
          читаются вслух и выводятся в OBS. Без аккаунтов, облаков и телеметрии.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.26, ease }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href={`${RELEASE}/download/YawaChatHub.exe`}
            className="group inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 text-[14.5px] font-bold text-void transition-all hover:shadow-[0_0_50px_rgba(255,255,255,0.25)]"
          >
            Скачать {APP_TAG}
            <Download size={16} className="transition-transform group-hover:translate-y-0.5" />
          </a>
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-8 py-4 text-[14.5px] font-semibold text-white/70 transition-all hover:border-white/35 hover:text-white"
          >
            Смотреть демо
          </a>
        </motion.div>

        {/* платформы — микро-строка */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.4 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-x-7 gap-y-3"
        >
          {PLATFORM_LIST.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-2 text-[12px] text-white/35">
              <span style={{ color: p.color }}>
                <PlatformIcon id={p.id} size={13} />
              </span>
              {p.label}
            </span>
          ))}
        </motion.div>
      </div>

      {/* живая лента сообщений */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="mt-20"
      >
        <div style={{ transform: "rotate(-1.1deg) scale(1.02)" }}>
          <Ribbon duration={40} />
        </div>
        <div className="mt-[3px]" style={{ transform: "rotate(0.6deg) scale(1.02)" }}>
          <Ribbon reverse duration={48} />
        </div>
      </motion.div>

      <div className="h-20" />
    </section>
  );
}
