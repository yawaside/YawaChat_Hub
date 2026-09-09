import { useEffect, useRef, useState } from "react";
import {
  Ban, Eye, EyeOff, Gavel, Lock, MessageSquareOff, Pause, Repeat, Shield, UserX,
} from "lucide-react";
import type { ChatMsg } from "../../lib/core";
import { PLATFORMS } from "../../lib/core";

export type ModerateAction = "ban" | "unban" | "timeout" | "delete" | "clear" | "emoteonly" | "slow" | "followers" | "subscribers";

export interface ModerateMenuProps {
  message: ChatMsg;
  onAction: (action: ModerateAction, seconds?: number) => void;
  onClose: () => void;
}

/**
 * Расширенное меню модерации, открывающееся по клику на ник пользователя.
 *
 * Набор действий зависит от площадки сообщения:
 *   Twitch — таймаут (выбор периода), бан, разбан, удаление сообщения,
 *            режимы чата (медленный, только смайлы, подписчики, сабы), очистка чата.
 *   VK     — таймаут (10 мин / 1 день), бан, удаление сообщения.
 *
 * Меню показывается ТОЛЬКО для пользователей с этих площадок (twitch/vk) —
 * чужие площадки (YouTube, Kick, TikTok, донаты) меню не дают.
 */

interface TimeoutPreset { label: string; seconds: number; }

const TWITCH_TIMEOUTS: TimeoutPreset[] = [
  { label: "10 секунд", seconds: 10 },
  { label: "1 минута", seconds: 60 },
  { label: "5 минут", seconds: 300 },
  { label: "10 минут", seconds: 600 },
  { label: "30 минут", seconds: 1800 },
  { label: "1 час", seconds: 3600 },
  { label: "6 часов", seconds: 21600 },
  { label: "1 день", seconds: 86400 },
  { label: "1 неделя", seconds: 604800 },
];

const VK_TIMEOUTS: TimeoutPreset[] = [
  { label: "10 минут", seconds: 600 },
  { label: "30 минут", seconds: 1800 },
  { label: "1 час", seconds: 3600 },
  { label: "1 день", seconds: 86400 },
];

const SLOW_MODES = [
  { label: "5 секунд", seconds: 5 },
  { label: "10 секунд", seconds: 10 },
  { label: "30 секунд", seconds: 30 },
  { label: "1 минута", seconds: 60 },
  { label: "выкл", seconds: 0 },
];

const FOLLOW_ONLY = [
  { label: "0 минут", seconds: 0 },
  { label: "10 минут", seconds: 10 },
  { label: "30 минут", seconds: 30 },
  { label: "1 час", seconds: 60 },
  { label: "1 день", seconds: 1440 },
];

export default function ModerateMenu({ message: m, onAction, onClose }: ModerateMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<"timeout" | "slow" | "followers" | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isTwitch = m.platform === "twitch";
  const isVk = m.platform === "vk";
  const timeouts = isTwitch ? TWITCH_TIMEOUTS : VK_TIMEOUTS;
  const meta = PLATFORMS[m.platform];

  const act = (action: ModerateAction, seconds?: number) => {
    onAction(action, seconds);
    onClose();
  };

  const Row = ({ icon, label, danger, onClick, sub }: { icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void; sub?: boolean }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[11.5px] transition-colors"
      style={{ color: danger ? "#e75f68" : "var(--dw-text)" }}
      onMouseEnter={() => isTwitch && sub === undefined && setSubmenu(null)}
    >
      <span className="shrink-0" style={{ color: danger ? "#e75f68" : "var(--dw-dim)" }}>{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {sub && <span className="text-[10px]" style={{ color: "var(--dw-dim)" }}>▸</span>}
    </button>
  );

  const Submenu = ({ title, items, onPick }: { title: string; items: TimeoutPreset[]; onPick: (s: number) => void }) => (
    <div className="absolute left-full top-0 z-40 ml-0.5 w-40 rounded-lg border shadow-xl" style={{ background: "var(--dw-panel)", borderColor: "var(--dw-line)" }}>
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--dw-dim)" }}>{title}</div>
      <div className="scroll-thin max-h-48 overflow-y-auto">
        {items.map((it) => (
          <button
            key={it.seconds}
            type="button"
            onClick={(e) => { e.stopPropagation(); onPick(it.seconds); }}
            className="block w-full px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--dw-hover)]"
            style={{ color: "var(--dw-text)" }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full z-30 mt-1 w-56 overflow-visible rounded-lg border shadow-2xl"
      style={{ background: "var(--dw-panel)", borderColor: "var(--dw-line)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* шапка: ник + площадка */}
      <div className="border-b px-3 py-2" style={{ borderColor: "var(--dw-line)" }}>
        <div className="flex items-center gap-2">
          <Shield size={12} style={{ color: meta.color }} />
          <span className="truncate text-[12px] font-semibold">{m.author}</span>
        </div>
        <div className="mt-0.5 text-[10px]" style={{ color: "var(--dw-dim)" }}>
          {meta.label}
        </div>
      </div>

      {/* Таймаут с выбором периода */}
      <div
        className="relative"
        onMouseEnter={() => setSubmenu("timeout")}
        onMouseLeave={() => submenu === "timeout" && setSubmenu(null)}
      >
        <Row icon={<Pause size={12} />} label="Таймаут" sub onClick={() => setSubmenu(submenu === "timeout" ? null : "timeout")} />
        {submenu === "timeout" && <Submenu title="Период таймаута" items={timeouts} onPick={(s) => act("timeout", s)} />}
      </div>

      {/* Чат-режимы — только Twitch */}
      {isTwitch && (
        <>
          <div
            className="relative"
            onMouseEnter={() => setSubmenu("slow")}
            onMouseLeave={() => submenu === "slow" && setSubmenu(null)}
          >
            <Row icon={<Repeat size={12} />} label="Медленный режим" sub onClick={() => setSubmenu(submenu === "slow" ? null : "slow")} />
            {submenu === "slow" && <Submenu title="Интервал" items={SLOW_MODES} onPick={(s) => act("slow", s)} />}
          </div>
          <Row icon={<MessageSquareOff size={12} />} label="Только смайлы" onClick={() => act("emoteonly")} />
          <div
            className="relative"
            onMouseEnter={() => setSubmenu("followers")}
            onMouseLeave={() => submenu === "followers" && setSubmenu(null)}
          >
            <Row icon={<EyeOff size={12} />} label="Только подписчики" sub onClick={() => setSubmenu(submenu === "followers" ? null : "followers")} />
            {submenu === "followers" && <Submenu title="Стаж подписки" items={FOLLOW_ONLY} onPick={(s) => act("followers", s)} />}
          </div>
          <Row icon={<Lock size={12} />} label="Только сабы" onClick={() => act("subscribers")} />
          <Row icon={<Gavel size={12} />} label="Очистить чат" onClick={() => act("clear")} />
        </>
      )}

      <div className="my-1 border-t" style={{ borderColor: "var(--dw-line)" }} />

      {/* «Удалить сообщение» убрано: ни Twitch, ни VK API не позволяют удалить
          одно сообщение без его ID — действие всегда падало с ошибкой. */}
      <Row icon={<Ban size={12} />} label="Забанить навсегда" danger onClick={() => act("ban")} />
      {isVk && <Row icon={<UserX size={12} />} label="Удалить из чата" danger onClick={() => act("ban")} />}
      {(isTwitch || isVk) && <Row icon={<Eye size={12} />} label="Разбанить" onClick={() => act("unban")} />}
    </div>
  );
}
