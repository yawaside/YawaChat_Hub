import { motion } from "framer-motion";
import type { ChatMsg } from "../../lib/core";
import { fmtTime } from "../../lib/core";
import { parseEmotes } from "../../lib/emotes";
import { getMessageMotion } from "../../lib/message-motion";
import type { AppVariant } from "../../lib/app-variants";
import type { ChatViewConfig } from "../../lib/widget";
import { PlatformBadge } from "../bits";

const BADGES: Record<string, { bg: string; fg: string }> = {
  MOD: { bg: "rgba(34,197,94,.13)", fg: "#22c55e" },
  VIP: { bg: "rgba(236,72,153,.13)", fg: "#ec4899" },
  SUB: { bg: "color-mix(in srgb, var(--dw-accent) 14%, transparent)", fg: "var(--dw-accent)" },
  GIFT: { bg: "rgba(234,179,8,.13)", fg: "#ca8a04" },
};

/** One renderer for the actual feed and its settings preview. */
export default function ChatMessage({ message: m, viewCfg: cfg, variant, delay = 0 }: {
  message: ChatMsg; viewCfg: ChatViewConfig; variant: AppVariant; delay?: number;
}) {
  const pad = Math.max(0, cfg.padding ?? 12);
  const rowGap = Math.max(0, cfg.rowGap ?? 6);
  const fontSize = cfg.fontSize ?? 15;
  const inline = variant.id === "terminal" || !(cfg.bubble ?? true) || pad === 0;
  const lineHeight = 1.35;
  if (m.sys) return (
    <div data-chat-event className="flex items-center gap-2" style={{ padding: "4px 0", marginBottom: rowGap }}>
      <span className="h-px flex-1" style={{ background: "var(--dw-line)" }} />
      <span className="min-w-0 text-center text-[10.5px]" style={{ color: "var(--dw-dim)", overflowWrap: "anywhere" }}>{m.text}</span>
      <span className="h-px flex-1" style={{ background: "var(--dw-line)" }} />
    </div>
  );
  const parts = m.parts?.length ? m.parts : parseEmotes(m.text);
  const text = parts.map((part, i) => part.type === "emote" ? (
    <img key={i} src={part.url} alt={part.value} title={part.value} loading="lazy"
      style={{ display: "inline-block", verticalAlign: "-.25em", height: fontSize * 1.4, width: "auto" }} />
  ) : <span key={i}>{part.value}</span>);
  const badges = cfg.showBadges && m.badges.map((badge) => (
    <span key={badge} className="rounded px-1 font-mono text-[9px] font-semibold"
      style={{ background: BADGES[badge]?.bg, color: BADGES[badge]?.fg, marginInline: 3 }}>{badge}</span>
  ));
  const time = cfg.showTime && <time dateTime={new Date(m.ts).toISOString()} className="font-mono text-[10px] tabular-nums"
    style={{ color: "var(--dw-dim)" }}>{fmtTime(m.ts)}</time>;
  // Slightly darker author colours in the light variant remain readable without changing brand SVGs.
  const nameColor = variant.light ? `color-mix(in srgb, ${m.color} 65%, #172033)` : m.color;
  const animation = getMessageMotion(cfg.messageEffect ?? "slide-up", cfg.effectDuration ?? .34, delay);

  if (inline) return (
    <motion.div {...animation} data-chat-message={m.id} data-message-platform={m.platform} data-message-layout="inline"
      className={variant.mono ? "font-mono" : ""}
      style={{ padding: `${Math.round(pad * .5)}px ${pad}px`, marginBottom: rowGap,
        fontSize, lineHeight, color: "var(--dw-text)", overflowWrap: "anywhere" }}>
      {cfg.showPlatform && <><PlatformBadge id={m.platform} size={Math.max(14, fontSize + 1)} iconSize={Math.round(fontSize * .78)} radius={3} />{" "}</>}
      {time && <>{time}{" "}</>}
      <strong style={{ color: nameColor }}>{m.author}</strong>{badges}<span style={{ opacity: .55 }}>: </span>{text}
    </motion.div>
  );

  return (
    <motion.div {...animation} data-chat-message={m.id} data-message-platform={m.platform} data-message-layout="card"
      className="group flex items-start" style={{ gap: 8, marginBottom: rowGap, fontSize, lineHeight }}>
      {cfg.showPlatform && <PlatformBadge id={m.platform} size={28} iconSize={18} radius={7} />}
      <div className="min-w-0 flex-1" style={{
        padding: `${Math.round(pad * .55)}px ${pad}px`, borderRadius: Math.max(0, cfg.radius),
        color: "var(--dw-text)", overflowWrap: "anywhere",
        background: cfg.style === "glass" ? "color-mix(in srgb, var(--dw-accent) 7%, var(--dw-panel))"
          : cfg.style === "minimal" ? "transparent" : "var(--dw-panel)",
        border: cfg.style === "classic" || cfg.style === "glass" ? "1px solid var(--dw-line)" : "none",
      }}>
        <div className="flex flex-wrap items-baseline gap-x-1">
          <strong style={{ color: nameColor }}>{m.author}</strong>{badges}
          {time && <span className="ml-auto">{time}</span>}
        </div>
        <p style={{ margin: "2px 0 0" }}>{text}</p>
      </div>
    </motion.div>
  );
}
