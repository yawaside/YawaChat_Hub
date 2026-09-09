import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { PlatformIcon, Reveal, Section } from "./bits";
import { getTheme, themeBg, WIDGET_THEMES } from "../lib/widget";

const DEMO = [
  { platform: "twitch" as const, author: "neon_wolf", color: "#a78bfa", text: "ЛЕЕЕЕТС ГОООУ" },
  { platform: "youtube" as const, author: "mila_lav", color: "#f472b6", text: "привет из чата, как настроение?" },
  { platform: "vk" as const, author: "КиберДед", color: "#4ade80", text: "респект за упорство" },
];

export default function WidgetSection() {
  const [themeId, setThemeId] = useState("minimal-dark");
  const [opacity, setOpacity] = useState(70);
  const [copied, setCopied] = useState(false);
  const theme = getTheme(themeId);
  const url = "http://127.0.0.1:47823/widget?token=…";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* noop */ }
  };

  return (
    <Section
      id="widget"
      kicker="obs"
      title="Виджет для OBS — чат прямо в сцене"
      desc="Локальный сервер на 127.0.0.1 с доступом по токену. Browser Source в OBS — задержка меньше секунды."
    >
      {/* живая настройка: круглые свотчи тем + слайдер + url — одной полосой */}
      <Reveal delay={0.05}>
        <div className="mt-12 flex flex-col gap-5 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 lg:flex-row lg:items-center lg:gap-7">
          <div className="flex items-center gap-2.5">
            {WIDGET_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setThemeId(t.id)}
                title={t.label}
                className="h-9 w-9 rounded-full transition-transform duration-200 hover:scale-110"
                style={{
                  background: `linear-gradient(135deg, ${t.swatch[0]} 0%, ${t.swatch[1] ?? t.swatch[0]} 55%, ${t.swatch[2] ?? t.swatch[0]} 100%)`,
                  boxShadow:
                    themeId === t.id
                      ? "0 0 0 2px #06060b, 0 0 0 4px #8b5cf6"
                      : "0 0 0 1px rgba(255,255,255,0.14)",
                  transform: themeId === t.id ? "scale(1.1)" : undefined,
                }}
              />
            ))}
          </div>

          <span className="hidden h-6 w-px bg-white/10 lg:block" />

          <div className="flex min-w-0 flex-1 items-center gap-4 lg:min-w-[220px] lg:max-w-[340px]">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">
              подложка
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              style={{ ["--p" as string]: `${opacity}%` }}
              className="flex-1"
            />
            <span className="w-9 text-right font-mono text-[11.5px] text-white/50">{opacity}%</span>
          </div>

          <span className="hidden h-6 w-px bg-white/10 lg:block" />

          <button
            onClick={copy}
            className="group inline-flex min-w-0 items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] py-2 pl-4 pr-3 transition-colors hover:border-viol/60"
            title="Скопировать URL виджета"
          >
            <code className="truncate font-mono text-[11px] text-white/40 transition-colors group-hover:text-white/70">
              {url}
            </code>
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-white/60 transition-colors group-hover:bg-viol group-hover:text-white">
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </span>
          </button>
        </div>
      </Reveal>

      {/* превью на «сцене» */}
      <Reveal delay={0.1}>
        <div className="checker relative mt-10 overflow-hidden rounded-3xl border border-white/[0.08] px-6 py-14 sm:py-20">
          <span className="absolute left-6 top-5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/20">
            сцена 1920×1080
          </span>
          <span className="absolute bottom-5 right-6 font-mono text-[10px] uppercase tracking-[0.22em] text-white/20">
            browser source
          </span>

          <div
            className="relative mx-auto w-full max-w-[440px] rounded-2xl p-5 transition-all duration-300"
            style={{
              background: themeBg(theme, opacity),
              border: `1px solid ${theme.border}`,
              boxShadow: theme.shadow,
            }}
          >
            <div className="space-y-3">
              {DEMO.map((m, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md"
                    style={{ color: m.color, background: `${m.color}1e` }}
                  >
                    <PlatformIcon id={m.platform} size={12} />
                  </span>
                  <div className="min-w-0">
                    <span className="mr-1.5 text-[13.5px] font-bold" style={{ color: theme.name }}>
                      {m.author}
                    </span>
                    <span className="text-[13.5px] leading-snug" style={{ color: theme.text }}>
                      {m.text}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div
              className="mt-4 flex items-center justify-between border-t pt-2.5"
              style={{ borderColor: theme.border }}
            >
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em]" style={{ color: theme.sub }}>
                {theme.label}
              </span>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: theme.sub }} />
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
