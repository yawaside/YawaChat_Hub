import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { AudioWaveform } from "lucide-react";
import { DonationIcon, KickIcon, TiktokIcon, TwitchIcon, VkIcon, YoutubeIcon } from "./brands";
import type { PlatformId } from "../lib/core";
import { PLATFORMS } from "../lib/core";

/* ---------- reveal on scroll ---------- */
export function Reveal({
  children, delay = 0, className, y = 32,
}: {
  children: ReactNode; delay?: number; className?: string; y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.75, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- section shell: редакционный стиль ----------
   Заголовок слева, описание справа, тонкая разделительная линия. */
export function Section({
  id, kicker, title, desc, children, className = "",
}: {
  id: string;
  kicker: string;
  title: ReactNode;
  desc?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`relative px-6 py-24 sm:px-10 md:py-32 ${className}`}>
      <div className="mx-auto w-full max-w-6xl">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div className="min-w-0 max-w-3xl">
              <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-viol">
                + {kicker}
              </span>
              <h2 className="mt-4 font-display text-[clamp(1.75rem,4.2vw,2.9rem)] font-bold leading-[1.05] tracking-tight text-white">
                {title}
              </h2>
            </div>
            {desc && (
              <p className="max-w-sm pb-1 text-[13px] leading-relaxed text-white/35">{desc}</p>
            )}
          </div>
        </Reveal>
        {children}
      </div>
    </section>
  );
}

/* ---------- logo ---------- */
export function Logo({ size = 16, accent = "#8b5cf6", accentSoft = "#a78bfa" }: { size?: number; accent?: string; accentSoft?: string }) {
  return (
    <a href="#top" className="group flex items-center gap-2.5">
      <span
        className="grid place-items-center rounded-[9px] transition-transform duration-500 group-hover:rotate-[10deg]"
        style={{
          width: size * 1.9,
          height: size * 1.9,
          background: `linear-gradient(135deg, ${accent} 0%, ${accentSoft} 100%)`,
          boxShadow: `0 0 16px ${accent}44`,
        }}
      >
        <AudioWaveform size={size * 0.85} strokeWidth={2.5} className="text-white" />
      </span>
      <span className="font-display text-[14px] font-bold leading-none tracking-tight">
        <span className="text-white/90">Yawa</span>
        <span className="mx-1 inline-block rounded-[5px] px-1 py-px align-middle text-[11px]" style={{
          color: "#fff",
          background: `linear-gradient(135deg, ${accent} 0%, ${accentSoft} 100%)`,
        }}>
          Chat
        </span>
        <span className="text-white/40">Hub</span>
      </span>
    </a>
  );
}

/* The same SVG renderer is used in channel cards, messages and previews.
   Keep its viewport square; flex/grid parents must never stretch the mark. */
export function PlatformIcon({ id, size = 16, color, className, style }: {
  id: PlatformId; size?: number; color?: string; className?: string; style?: React.CSSProperties;
}) {
  const Icon = { twitch: TwitchIcon, youtube: YoutubeIcon, kick: KickIcon, tiktok: TiktokIcon, vk: VkIcon, donation: DonationIcon }[id];
  const px = Math.max(1, Math.round(size));
  return <Icon size={px} className={className} style={{
    ...style, ...(color ? { color } : {}), display: "block", flex: "none",
    width: px, height: px, minWidth: px, minHeight: px, maxWidth: "none",
  }} />;
}

/** Centered platform mark with a fixed, non-shrinking tile. */
export function PlatformBadge({ id, size = 24, iconSize = 16, radius = 6, plain = false, glow = false }: {
  id: PlatformId; size?: number; iconSize?: number; radius?: number; plain?: boolean; glow?: boolean;
}) {
  const px = Math.max(14, Math.round(size));
  const glyph = Math.min(px - (plain ? 0 : 4), Math.max(10, Math.round(iconSize)));
  const meta = PLATFORMS[id];
  return (
    <span data-platform-badge={id} title={meta.label} aria-label={meta.label}
      style={{ display: "inline-grid", placeItems: "center", width: px, height: px,
        minWidth: px, minHeight: px, flex: `0 0 ${px}px`, lineHeight: 0,
        verticalAlign: "-0.18em", borderRadius: Math.max(0, radius),
        background: plain ? "transparent" : id === "donation" ? "#191919" : meta.color,
        boxShadow: glow ? `0 0 10px ${meta.color}55` : "none",
        color: plain ? meta.color : id === "kick" ? "#13220b" : "#fff" }}>
      <PlatformIcon id={id} size={glyph} />
    </span>
  );
}

export function PlatformChip({ id, active = true }: { id: PlatformId; active?: boolean }) {
  const p = PLATFORMS[id];
  return (
    <span
      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px]"
      style={{ background: `${p.color}22`, color: p.color, opacity: active ? 1 : 0.4 }}
      title={p.label}
    >
      <PlatformIcon id={id} size={12} />
    </span>
  );
}

/* ---------- small switch ---------- */
export function Switch({
  on, onChange, small = false, accent = "#8b5cf6",
}: {
  on: boolean; onChange: (v: boolean) => void; small?: boolean; accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className="relative shrink-0 rounded-full transition-colors duration-300"
      style={{
        width: small ? 34 : 44,
        height: small ? 19 : 24,
        background: on ? accent : "rgba(255,255,255,0.14)",
        boxShadow: on ? `0 0 14px ${accent}55` : "none",
      }}
    >
      <span
        className="absolute top-1/2 rounded-full bg-white transition-all duration-300"
        style={{
          width: small ? 13 : 17,
          height: small ? 13 : 17,
          left: small ? 3 : 3.5,
          transform: `translate(${on ? (small ? 15 : 20) : 0}px, -50%)`,
        }}
      />
    </button>
  );
}

/* ---------- kbd combo ---------- */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-[10px] text-fog">+</span>}
          <kbd className="kbd">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

/* ---------- equalizer bars ----------
   Индикатор озвучки. Размер ЖЁСТКО зафиксирован, поэтому при переключении
   active <-> idle ничего не «прыгает» и не мигает: меняется только анимация
   и высота полос, а ширина/высота контейнера остаются прежними.
   Компонент задуман всегда смонтированным — не подменяйте его на другую
   иконку в зависимости от speech.now, иначе часть интерфейса начнёт мигать. */
export function Eq({
  color = "currentColor",
  active = true,
  size = 14,
}: {
  color?: string;
  active?: boolean;
  size?: number;
}) {
  const bars = [0.3, 0.72, 0.5, 0.26];
  const durations = [0.9, 0.55, 0.75, 0.45];
  const barWidth = 2.5;
  const gap = 2;
  const width = bars.length * barWidth + (bars.length - 1) * gap;

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap,
        width,
        height: size,
        minWidth: width,
        minHeight: size,
        flex: `0 0 ${width}px`,
        lineHeight: 0,
      }}
    >
      {bars.map((rest, i) => (
        <span
          key={i}
          style={{
            width: barWidth,
            height: "100%",
            borderRadius: 99,
            background: color,
            transform: active ? undefined : `scaleY(${rest})`,
            transformOrigin: "bottom",
            animation: active ? `eq ${durations[i]}s ease-in-out ${i * 0.12}s infinite` : "none",
            transition: "transform 160ms ease",
          }}
        />
      ))}
    </span>
  );
}
