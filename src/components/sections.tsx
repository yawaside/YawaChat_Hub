import {
  ArrowUpRight, Download, MonitorPlay, Package, Radio, ShieldCheck,
  SlidersHorizontal, Sparkles, Volume2, Zap,
} from "lucide-react";
import { Keys, Logo, Reveal, Section } from "./bits";
import { GithubIcon } from "./brands";
import { APP_TAG, APP_VERSION } from "../version";
import { DEFAULT_HOTKEYS, HOTKEY_META } from "../lib/widget";

const RELEASE = "https://github.com/yawaside/Yawachat.test/releases/latest";

/* ================= возможности: редакционный список ================= */

const FEATURES = [
  {
    icon: Radio,
    title: "Пять площадок сразу",
    text: "Twitch, YouTube Live, VK Play Live, Kick и TikTok Live — в одной ленте с авто-переподключением.",
  },
  {
    icon: Volume2,
    title: "Озвучка голосом",
    text: "Системные голоса Windows (SAPI) и онлайн-голоса Edge: скорость, громкость, шаблон, очередь с пропуском.",
  },
  {
    icon: ShieldCheck,
    title: "Фильтры и банворды",
    text: "Пресеты мата, скама, спама и 18+, свои списки, маскирование слов и белый список авторов.",
  },
  {
    icon: MonitorPlay,
    title: "Виджет для OBS",
    text: "Локальный сервер с токеном, 9 тем и прозрачная подложка. Browser Source — и готово.",
  },
  {
    icon: Sparkles,
    title: "Игровой оверлей",
    text: "Лента поверх игры: перетаскивание, сквозные клики, блокировка позиции.",
  },
  {
    icon: SlidersHorizontal,
    title: "Без телеметрии",
    text: "settings.json рядом с exe. Никаких аккаунтов, облаков и установки в реестр.",
  },
];

export function Features() {
  return (
    <Section
      id="features"
      kicker="возможности"
      title="Всё, что нужно стримеру. Ничего лишнего."
      desc="Приложение делает одну вещь идеально: собирает чат со всех площадок и помогает его не пропустить."
    >
      <div className="mt-4 divide-y divide-white/[0.07] border-b border-white/[0.07]">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.04} y={16}>
            <div className="group grid gap-3 px-2 py-8 transition-colors duration-300 hover:bg-white/[0.02] sm:grid-cols-[72px_1fr] sm:items-baseline lg:grid-cols-[72px_300px_1fr_40px]">
              <span className="font-mono text-[13px] text-white/20 transition-colors group-hover:text-viol">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="flex items-center gap-3 font-display text-[17px] font-bold text-white/90">
                <f.icon size={17} className="shrink-0 text-viol" />
                {f.title}
              </h3>
              <p className="text-[13.5px] leading-relaxed text-white/40">{f.text}</p>
              <ArrowUpRight
                size={18}
                className="hidden text-white/25 opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100 lg:block"
              />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ================= горячие клавиши ================= */

export function Hotkeys() {
  return (
    <Section
      id="hotkeys"
      kicker="управление"
      title="Глобальные горячие клавиши"
      desc="Работают даже когда окно свёрнуто в трей. Комбинации переназначаются в настройках."
    >
      <div className="mt-4 divide-y divide-white/[0.07] border-b border-white/[0.07]">
        {HOTKEY_META.map((h, i) => (
          <Reveal key={h.id} delay={i * 0.03} y={12}>
            <div className="group flex flex-wrap items-center justify-between gap-3 px-2 py-5 transition-colors duration-300 hover:bg-white/[0.02]">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-[12px] text-white/20 transition-colors group-hover:text-cy">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <span className="text-[14.5px] font-semibold text-white/85">{h.label}</span>
                  <span className="ml-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/25">
                    {h.group}
                  </span>
                </div>
              </div>
              <Keys keys={(DEFAULT_HOTKEYS[h.id] || "").split("+")} />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ================= скачать: большой центрированный CTA ================= */

export function DownloadSection() {
  return (
    <section id="download" className="relative overflow-hidden border-t border-white/[0.07] px-6 py-28 sm:px-10 md:py-40">
      {/* гигантское призрачное слово на фоне */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <span className="select-none whitespace-nowrap font-display text-[19vw] font-extrabold leading-none text-white/[0.025]">
          СКАЧАТЬ
        </span>
      </div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-viol/[0.12] blur-[120px]" />

      <div className="relative mx-auto max-w-3xl text-center">
        <Reveal>
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-viol">+ скачать</span>
          <h2 className="mt-5 font-display text-[clamp(2rem,5.5vw,3.8rem)] font-extrabold leading-[1.02] tracking-tight text-white">
            Готово к{" "}
            <span className="bg-gradient-to-r from-viol to-cy bg-clip-text text-transparent">запуску</span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[14.5px] leading-relaxed text-white/40">
            YawaChatHub {APP_VERSION} — две сборки Windows x64 на выбор:
            один файл portable или классический установщик.
          </p>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-12 grid gap-3 sm:grid-cols-2">
            <a
              href={`${RELEASE}/download/YawaChatHub.exe`}
              className="group flex items-center justify-between gap-6 rounded-3xl bg-white px-7 py-6 text-left text-void transition-all hover:shadow-[0_0_60px_rgba(255,255,255,0.2)]"
            >
              <span>
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] opacity-50">
                  <Zap size={12} /> portable
                </span>
                <span className="mt-1.5 block text-[19px] font-extrabold">YawaChatHub.exe</span>
                <span className="mt-0.5 block text-[12px] opacity-60">один файл, без установки</span>
              </span>
              <Download size={22} className="shrink-0 transition-transform group-hover:translate-y-1" />
            </a>

            <a
              href={`${RELEASE}/download/YawaChatHub-Setup.exe`}
              className="group flex items-center justify-between gap-6 rounded-3xl border border-white/15 px-7 py-6 text-left transition-all hover:border-white/40 hover:bg-white/[0.03]"
            >
              <span>
                <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
                  <Package size={12} /> installer
                </span>
                <span className="mt-1.5 block text-[19px] font-extrabold text-white">Setup.exe</span>
                <span className="mt-0.5 block text-[12px] text-white/40">ярлыки в меню «Пуск»</span>
              </span>
              <Download size={22} className="shrink-0 text-white/50 transition-transform group-hover:translate-y-1" />
            </a>
          </div>
        </Reveal>

        <Reveal delay={0.16}>
          <a
            href="https://github.com/yawaside/Yawachat.test/releases"
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-2 font-mono text-[12px] text-white/30 transition-colors hover:text-viol"
          >
            <GithubIcon size={13} />
            {APP_TAG} · все релизы на GitHub
            <ArrowUpRight size={13} />
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/* ================= подвал: минимум ссылок + гигантский вордмарк ================= */

export function Footer() {
  return (
    <footer className="border-t border-white/[0.07] px-6 pt-14 sm:px-10">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="font-mono text-[10.5px] text-white/25">{APP_TAG} · MIT</span>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-[12.5px] text-white/30">
            <a href="#demo" className="transition-colors hover:text-white">Демо</a>
            <a href="#features" className="transition-colors hover:text-white">Возможности</a>
            <a href="#download" className="transition-colors hover:text-white">Скачать</a>
            <a
              href="https://github.com/yawaside/Yawachat.test"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 transition-colors hover:text-white"
            >
              <GithubIcon size={13} /> GitHub
            </a>
          </div>
        </div>

        <div aria-hidden className="mt-16 select-none overflow-hidden">
          <div className="translate-y-[18%] whitespace-nowrap text-center font-display text-[clamp(3rem,12vw,10rem)] font-extrabold leading-[0.85] tracking-tight text-white/[0.045]">
            YAWACHATHUB
          </div>
        </div>
      </div>
    </footer>
  );
}
