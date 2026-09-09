import { memo, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { VolumeX, Volume2 } from "lucide-react";
import type { ChatMsg } from "../../lib/core";
import { fmtTime } from "../../lib/core";
import { parseEmotes } from "../../lib/emotes";
import { getMessageMotion } from "../../lib/message-motion";
import type { AppVariant } from "../../lib/app-variants";
import type { ChatViewConfig } from "../../lib/widget";
import { PlatformBadge } from "../bits";
import ModerateMenu from "./ModerateMenu";
import type { ModerateAction } from "./ModerateMenu";

const BADGES: Record<string, { bg: string; fg: string }> = {
  MOD: { bg: "rgba(34,197,94,.13)", fg: "#22c55e" },
  VIP: { bg: "rgba(236,72,153,.13)", fg: "#ec4899" },
  SUB: { bg: "color-mix(in srgb, var(--dw-accent) 14%, transparent)", fg: "var(--dw-accent)" },
  GIFT: { bg: "rgba(234,179,8,.13)", fg: "#ca8a04" },
};

export interface ChatMessageProps {
  message: ChatMsg;
  viewCfg: ChatViewConfig;
  variant: AppVariant;
  delay?: number;
  /** Автор уже в списке «не озвучивать». */
  muted?: boolean;
  /** Переключить озвучку автора прямо из ленты. */
  onToggleMute?: (author: string, mute: boolean) => void;
  /** Модерация сообщения: бан / таймаут (чат-бот). */
  onModerate?: (m: ChatMsg, action: ModerateAction, seconds?: number) => void;
}

/** One renderer for the actual feed and its settings preview. */
function ChatMessage({ message: m, viewCfg: cfg, variant, delay = 0, muted = false, onToggleMute, onModerate }: ChatMessageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Закрываем меню модерации по клику вне его или Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

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

  /* Кнопка появляется по наведению и не занимает места в потоке:
     размеры строки не меняются, поэтому лента не «дёргается». */
  const muteButton = onToggleMute ? (
    <button
      type="button"
      data-mute-author={m.author}
      aria-pressed={muted}
      title={muted ? `Снова озвучивать ${m.author}` : `Не озвучивать ${m.author}`}
      aria-label={muted ? `Снова озвучивать ${m.author}` : `Не озвучивать ${m.author}`}
      onClick={(e) => { e.stopPropagation(); onToggleMute(m.author, !muted); }}
      className="chat-mute-button"
      style={{ color: muted ? "#e0685f" : "var(--dw-dim)" }}
    >
      {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
    </button>
  ) : null;

  /* Модерация доступна ТОЛЬКО для сообщений Twitch и VK —
     чужие площадки (YouTube, Kick, TikTok, донаты) меню не показывают. */
  const canModerate = Boolean(onModerate && !m.sys && (m.platform === "twitch" || m.platform === "vk"));

  const moderate = (action: ModerateAction, seconds?: number) => {
    setMenuOpen(false);
    onModerate?.(m, action, seconds);
  };

  /* Ник — кнопка: клик открывает меню модерации. */
  const author = canModerate ? (
    <span className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Действия с ${m.author}`}
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        className="chat-author-button"
        style={{ color: menuOpen ? "var(--dw-accent-2)" : nameColor, textDecoration: muted ? "line-through" : undefined }}
      >
        <strong>{m.author}</strong>
      </button>
      {menuOpen && (
        <ModerateMenu message={m} onAction={moderate} onClose={() => setMenuOpen(false)} />
      )}
    </span>
  ) : (
    <strong style={{ color: nameColor, textDecoration: muted ? "line-through" : undefined }}>
      {m.author}
    </strong>
  );

  if (inline) return (
    <motion.div {...animation} data-chat-message={m.id} data-message-platform={m.platform} data-message-layout="inline"
      data-author-muted={muted || undefined}
      className={`chat-row ${variant.mono ? "font-mono" : ""}`}
      style={{ padding: `${Math.round(pad * .5)}px ${pad}px`, marginBottom: rowGap,
        fontSize, lineHeight, color: "var(--dw-text)", overflowWrap: "anywhere", opacity: muted ? .72 : 1 }}>
      {cfg.showPlatform && <><PlatformBadge id={m.platform} size={Math.max(14, fontSize + 1)} iconSize={Math.round(fontSize * .78)} radius={3} />{" "}</>}
      {time && <>{time}{" "}</>}
      {author}{badges}<span style={{ opacity: .55 }}>: </span>{text}
      {muteButton}
    </motion.div>
  );

  return (
    <motion.div {...animation} data-chat-message={m.id} data-message-platform={m.platform} data-message-layout="card"
      data-author-muted={muted || undefined}
      className="chat-row group flex items-start" style={{ gap: 8, marginBottom: rowGap, fontSize, lineHeight, opacity: muted ? .72 : 1 }}>
      {cfg.showPlatform && <PlatformBadge id={m.platform} size={28} iconSize={18} radius={7} />}
      <div className="min-w-0 flex-1" style={{
        padding: `${Math.round(pad * .55)}px ${pad}px`, borderRadius: Math.max(0, cfg.radius),
        color: "var(--dw-text)", overflowWrap: "anywhere",
        background: cfg.style === "glass" ? "color-mix(in srgb, var(--dw-accent) 7%, var(--dw-panel))"
          : cfg.style === "minimal" ? "transparent" : "var(--dw-panel)",
        border: cfg.style === "classic" || cfg.style === "glass" ? "1px solid var(--dw-line)" : "none",
      }}>
        <div className="flex flex-wrap items-baseline gap-x-1">
          {author}{badges}
          <span className="ml-auto flex items-center gap-1">{time}{muteButton}</span>
        </div>
        <p style={{ margin: "2px 0 0" }}>{text}</p>
      </div>
    </motion.div>
  );
}

/* Лента перерисовывается часто (новые сообщения, статусы каналов, состояние озвучки).
   memo не даёт перерисовывать уже показанные строки, у которых ничего не изменилось. */
export default memo(ChatMessage);
