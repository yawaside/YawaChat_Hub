import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell, BellOff, ChevronDown, ChevronUp, ChevronsDown, Eye, ListX, Pause, Play,
  Plus, PanelLeftClose, PanelLeftOpen, Radio, Search, SkipForward, Trash2,
  Wifi, WifiOff, X,
} from "lucide-react";
import { getSp } from "../../lib/bridge";
import type { SpeechEngine } from "../../lib/core";
import type { ChatMsg, PlatformId } from "../../lib/core";
import { PLATFORMS, PLATFORM_LIST } from "../../lib/core";
import { useEmotes } from "../../lib/emotes";
import type { Channel } from "../../lib/bridge";
import type { ChatViewConfig } from "../../lib/widget";
import { aggregateViewers, fmtViewers, fmtViewersFull, pluralViewers, totalViewers } from "../../lib/viewers";
import { Eq, PlatformBadge, PlatformIcon } from "../bits";
import ChatMessage from "./ChatMessage";
import { Btn } from "./ui";
import { APP_VERSION } from "../../version";
import type { AppVariant } from "../../lib/app-variants";

const STATUS: Record<Channel["status"], { label: string; color: string; glow: string }> = {
  online: { label: "подключено", color: "#4ade80", glow: "rgba(74,222,128,0.55)" },
  offline: { label: "офлайн", color: "#8b91a8", glow: "transparent" },
  error: { label: "ошибка", color: "#f87171", glow: "rgba(248,113,113,0.45)" },
  connecting: { label: "подключение…", color: "#facc15", glow: "rgba(250,204,21,0.45)" },
};

/* ================= форма добавления канала ================= */

function AddChannelForm({
  onAdd, toast, onClose,
}: {
  onAdd: (p: PlatformId, id: string) => void;
  toast: (t: string) => void;
  onClose?: () => void;
}) {
  const [platform, setPlatform] = useState<PlatformId>("twitch");
  const [value, setValue] = useState("");

  const submit = () => {
    const raw = value.trim();
    if (!raw) return;
    if (/^https?:\/\//i.test(raw) || raw.includes("/") || raw.includes("?") || raw.includes("&")) {
      toast("Нужен только username канала, без ссылок");
      return;
    }
    const username = raw.replace(/^@/, "");
    if (!/^[a-zA-Z0-9_.-]{2,40}$/.test(username)) {
      toast("Некорректный username. Разрешены: a-z, 0-9, _, ., -");
      return;
    }
    if (platform === "youtube" && (/^UC[A-Za-z0-9_-]{10,}$/.test(raw) || /^[A-Za-z0-9_-]{11}$/.test(raw))) {
      toast("Для YouTube нужен username/@handle канала, не ID и не ссылка");
      return;
    }
    const channel = platform === "tiktok" ? `@${username}` : username;
    onAdd(platform, channel);
    setValue("");
    onClose?.();
    toast(`Канал добавлен: ${PLATFORMS[platform].label} / ${channel}`);
  };

  return (
    <div className="space-y-3 rounded-2xl border p-3.5" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
      <div className="grid grid-cols-5 gap-1.5">
        {PLATFORM_LIST.map((p) => {
          const active = platform === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              title={p.label}
              className="grid h-10 place-items-center rounded-xl border transition-all"
              style={{
                borderColor: active ? p.color : "var(--dw-line)",
                background: active ? `${p.color}1c` : "var(--dw-panel2)",
                color: active ? p.color : "var(--dw-dim)",
                boxShadow: active ? `0 0 14px ${p.color}33` : "none",
              }}
            >
              <PlatformIcon id={p.id} size={15} />
            </button>
          );
        })}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={PLATFORMS[platform].hint}
        title={PLATFORMS[platform].hint}
        autoFocus
        className="h-10 w-full rounded-xl border bg-transparent px-3 text-[13px] outline-none placeholder:text-[var(--dw-dim)] focus:border-[var(--dw-accent)]"
        style={{ borderColor: "var(--dw-line)", background: "var(--dw-input)" }}
      />
      <Btn variant="primary" className="h-9 w-full !rounded-xl" onClick={submit} disabled={!value.trim()}>
        <Plus size={14} /> Подключить
      </Btn>
    </div>
  );
}

/* ================= карточка канала ================= */

function ChannelCard({ c, onRemove, compact = false, mono = false }: { c: Channel; onRemove: (id: string) => void; compact?: boolean; mono?: boolean }) {
  const st = STATUS[c.status];
  const online = c.status === "online";
  const hasViewers = online && typeof c.viewers === "number" && Number.isFinite(c.viewers);
  const meta = PLATFORMS[c.platform];

  if (compact) {
    return (
      <div className="group relative mx-auto" title={`${meta.label} · ${c.channelId} · ${st.label}`}>
        <span
          className="relative grid h-11 w-11 place-items-center rounded-2xl border transition-all duration-200 group-hover:scale-105"
          style={{
            borderColor: "var(--dw-line)",
            background: `linear-gradient(135deg, ${meta.color}26 0%, ${meta.color}0d 100%)`,
            color: meta.color,
            boxShadow: online ? `0 0 16px ${st.glow}` : "none",
          }}
        >
          <PlatformIcon id={c.platform} size={16} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2" style={{ background: st.color, borderColor: "var(--dw-panel)", boxShadow: `0 0 8px ${st.glow}` }} />
        </span>
        {hasViewers && (
          <span className="mt-1 block text-center font-mono text-[9px] leading-none tabular-nums" style={{ color: "var(--dw-dim)" }}>
            {fmtViewers(c.viewers)}
          </span>
        )}
        <button type="button" onClick={() => onRemove(c.id)} className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100" title="Отключить канал">
          <X size={9} />
        </button>
      </div>
    );
  }

  /* Compact, fluid tile: no fixed 190px width and no overflowing status text. */
  if (mono) {
    return (
      <div data-terminal-channel={c.platform}
        className="group relative flex h-12 min-w-0 items-center gap-2 rounded-md border px-2"
        style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel2)" }}
        title={`${meta.label} · ${c.channelId} · ${st.label}${hasViewers ? ` · ${fmtViewersFull(c.viewers)} зрителей` : ""}`}>
        <PlatformBadge id={c.platform} size={24} iconSize={16} radius={5} />
        <div className="min-w-0 flex-1">
          <div className="truncate pr-3 font-mono text-[11px] font-semibold">{c.channelId}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1 text-[10px] leading-none">
            <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: st.color }} />
            <span className="truncate" style={{ color: st.color }}>{online ? "В эфире" : st.label}</span>
            {hasViewers && <span className="ml-auto shrink-0 font-mono tabular-nums" style={{ color: "var(--dw-dim)" }}>{fmtViewers(c.viewers)}</span>}
          </div>
        </div>
        <button type="button" onClick={() => onRemove(c.id)}
          title={`Отключить ${c.channelId}`} aria-label={`Отключить ${c.channelId}`}
          className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded opacity-50 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          style={{ color: "var(--dw-dim)" }}><X size={10} /></button>
      </div>
    );
  }

  /* стандартная карточка (Команда / Студия) */
  return (
    <div
      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3 transition-all duration-200"
      style={{
        borderColor: "var(--dw-line)",
        background: "var(--dw-panel2)",
        boxShadow: "var(--dw-card-shadow, 0 1px 2px rgba(0,0,0,0.06))",
      }}
    >
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-full" style={{ background: meta.color, opacity: 0.85 }} />
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
        style={{ background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}cc 100%)`, boxShadow: `0 4px 14px ${meta.color}30` }}
      >
        <PlatformIcon id={c.platform} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold tracking-tight" style={{ color: "var(--dw-text)" }}>{c.channelId}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color, boxShadow: `0 0 8px ${st.glow}` }} />
          <span className="text-[10.5px]" style={{ color: st.color }}>{st.label}</span>
          {online && (
            <span
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tabular-nums"
              style={{ background: "var(--dw-input)", color: hasViewers ? "var(--dw-text)" : "var(--dw-dim)" }}
              title={hasViewers ? `${fmtViewersFull(c.viewers)} ${pluralViewers(c.viewers as number)} сейчас` : "Онлайн уточняется"}
            >
              <Eye size={9} style={{ color: "var(--dw-dim)" }} />
              {hasViewers ? fmtViewers(c.viewers) : "…"}
            </span>
          )}
        </div>
      </div>
      <button onClick={() => onRemove(c.id)} title="Отключить канал" className="grid h-6 w-6 shrink-0 place-items-center rounded-lg opacity-0 transition-all hover:bg-[rgba(248,113,113,0.15)] hover:text-red-400 group-hover:opacity-100" style={{ color: "var(--dw-dim)" }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ================= терминальный статус-бар (тикер времени) ================= */

function TerminalClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span>{now.toLocaleTimeString("ru-RU", { hour12: false })}</span>;
}

function StatusBar({ speech, channels, viewersTotal, feedTotal }: { speech: SpeechEngine; channels: Channel[]; viewersTotal: number | null; feedTotal: number }) {
  const online = channels.filter((c) => c.status === "online").length;
  const live = online > 0;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-1.5 font-mono text-[10px]"
      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
    >
      <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-[0.14em]" style={{ color: live ? "#4ade80" : "var(--dw-dim)" }}>
        <span className="h-1.5 w-1.5 animate-breathe rounded-full" style={{ background: live ? "#4ade80" : "var(--dw-line)" }} />
        {live ? `live ${online}/${channels.length}` : "idle"}
      </span>
      {viewersTotal !== null && <span className="tabular-nums" style={{ color: "var(--dw-dim)" }}>{viewersTotal.toLocaleString("ru-RU")} зр</span>}
      <span className="tabular-nums" style={{ color: "var(--dw-dim)" }}>msg {feedTotal}</span>
      <span className="inline-flex items-center gap-2">
        <span style={{ color: "var(--dw-dim)" }}>
          tts {speech.enabled ? (speech.now ? `» ${speech.now.label}` : `queue ${speech.queueSize}`) : "off"}
        </span>
        <button onClick={() => speech.setPaused(!speech.paused)} title="Пауза/продолжить" className="transition-opacity hover:opacity-100" style={{ color: "var(--dw-dim)" }}>
          {speech.paused ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button onClick={speech.skip} title="Пропустить" className="transition-opacity hover:opacity-100" style={{ color: "var(--dw-dim)" }}>
          <SkipForward size={11} />
        </button>
        <button onClick={() => speech.clearQueue()} title="Очистить очередь" className="transition-opacity hover:opacity-100" style={{ color: "var(--dw-dim)" }}>
          <ListX size={11} />
        </button>
      </span>
      <span className="ml-auto tabular-nums" style={{ color: "var(--dw-dim)" }}>
        <TerminalClock /> · yawa v{APP_VERSION}
      </span>
    </div>
  );
}

/* ================= главный компонент ================= */

export default function ChatPanel({
  feed, channels, speech, viewCfg, variant, channelsCollapsed, onChannelsCollapsed,
  onSpeechEnabledChange, onClear, onAddChannel, onRemoveChannel, toast,
}: {
  feed: ChatMsg[];
  channels: Channel[];
  speech: SpeechEngine;
  viewCfg: ChatViewConfig;
  variant: AppVariant;
  channelsCollapsed: boolean;
  onChannelsCollapsed: (collapsed: boolean) => void;
  onSpeechEnabledChange: (enabled: boolean) => void;
  onClear: () => void;
  onAddChannel: (p: PlatformId, id: string) => void;
  onRemoveChannel: (id: string) => void;
  toast: (t: string) => void;
}) {
  const sp = getSp();
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<PlatformId>>(new Set());
  const [follow, setFollow] = useState(true);
  const [showSys, setShowSys] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [mobileChannels, setMobileChannels] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const togglePlatform = (p: PlatformId) => {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  };

  const q = query.trim().toLowerCase();
  const shown = feed.filter(
    (m) => (showSys || !m.sys) && !hidden.has(m.platform) && (!q || m.text.toLowerCase().includes(q) || m.author.toLowerCase().includes(q))
  );

  useEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  const resumeScroll = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollow(true);
  };

  useEmotes(channels);

  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const p of PLATFORM_LIST) acc[p.id] = feed.filter((m) => !m.sys && m.platform === p.id).length;
    return acc;
  }, [feed]);

  const totalMessages = useMemo(() => feed.filter((m) => !m.sys).length, [feed]);
  const allActive = hidden.size === 0;
  const viewersTotal = useMemo(() => totalViewers(aggregateViewers(channels)), [channels]);
  const onlineCount = channels.filter((c) => c.status === "online").length;

  const isTerm = variant.id === "terminal";
  const isStudio = variant.id === "studio";

  /* отступы ленты: 0 = сообщения прижаты к краям окна */
  const chatFeedPad = Math.max(0, viewCfg.feedPadding ?? 20);

  /* ---------- общая панель инструментов над лентой ---------- */
  const toolbar = (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 ${isTerm ? "font-mono" : ""}`}
      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
    >
      <button
        onClick={() => setHidden(new Set())}
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold transition-all"
        style={{
          background: allActive ? "linear-gradient(135deg, var(--dw-accent), var(--dw-accent-2))" : "var(--dw-input)",
          color: allActive ? (isStudio ? "#ffffff" : "#fff") : "var(--dw-dim)",
          boxShadow: allActive ? "color-mix(in srgb, var(--dw-accent) 40%, transparent)" : "none",
        }}
        title="Показать все площадки"
      >
        Все
        {!allActive && totalMessages > 0 && <span className="font-mono text-[10px] opacity-70">{totalMessages}</span>}
      </button>

      {PLATFORM_LIST.map((p) => {
        const off = hidden.has(p.id);
        const count = counts[p.id] ?? 0;
        return (
          <button
            key={p.id}
            onClick={() => togglePlatform(p.id)}
            title={`${p.label}: ${off ? "скрыто" : "показано"}`}
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-semibold transition-all ${isTerm ? "font-mono" : ""}`}
            style={{
              borderColor: off ? "var(--dw-line)" : `${p.color}55`,
              background: off ? "transparent" : `${p.color}1c`,
              color: off ? "var(--dw-dim)" : p.color,
              opacity: off ? 0.5 : 1,
            }}
          >
            <PlatformIcon id={p.id} size={11} />
            <span className="font-mono text-[11px]">{count}</span>
          </button>
        );
      })}

      <div
        className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-full border px-3.5 transition-colors focus-within:border-[var(--dw-accent)]"
        style={{ borderColor: "var(--dw-line)", background: "var(--dw-input)" }}
      >
        <Search size={13} className="shrink-0" style={{ color: "var(--dw-dim)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isTerm ? "grep по чату…" : "Поиск…"}
          className="h-full w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--dw-dim)]"
        />
        {query && (
          <button onClick={() => setQuery("")} style={{ color: "var(--dw-dim)" }} title="Сбросить">
            <X size={12} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button type="button" title={follow ? "Автопрокрутка включена" : "Автопрокрутка выключена"} onClick={() => setFollow((v) => !v)} className="grid h-8 w-8 place-items-center rounded-full border transition-colors" style={{ borderColor: follow ? "color-mix(in srgb, var(--dw-accent) 35%, transparent)" : "var(--dw-line)", background: follow ? "color-mix(in srgb, var(--dw-accent) 10%, transparent)" : "var(--dw-input)", color: follow ? "var(--dw-accent-2)" : "var(--dw-dim)" }}>
          <ChevronsDown size={14} />
        </button>
        <button type="button" title={showSys ? "Скрыть события подключения" : "Показывать события подключения"} onClick={() => setShowSys((v) => !v)} className="grid h-8 w-8 place-items-center rounded-full border transition-colors" style={{ borderColor: showSys ? "color-mix(in srgb, var(--dw-accent) 35%, transparent)" : "var(--dw-line)", background: showSys ? "color-mix(in srgb, var(--dw-accent) 10%, transparent)" : "var(--dw-input)", color: showSys ? "var(--dw-accent-2)" : "var(--dw-dim)" }}>
          {showSys ? <Bell size={14} /> : <BellOff size={14} />}
        </button>
        <button type="button" title="Очистить ленту" onClick={onClear} className="grid h-8 w-8 place-items-center rounded-full border transition-colors hover:border-red-400/40" style={{ borderColor: "var(--dw-line)", background: "var(--dw-input)", color: "var(--dw-dim)" }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );

  /* ---------- лента сообщений ---------- */
  const feedArea = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: "var(--dw-bg)" }}>
      {/* каналы (mobile): terminal already displays the same channels above */}
      {!isTerm && <div className="border-b px-3 py-2.5 md:hidden" style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}>
        <button onClick={() => setMobileChannels((v) => !v)} className="flex w-full items-center justify-between text-[12.5px] font-semibold">
          <span>
            Каналы · {onlineCount} подключено
            {viewersTotal !== null && (
              <span className="ml-1.5 font-mono text-[11.5px] tabular-nums" style={{ color: "#4ade80" }}>
                · {fmtViewersFull(viewersTotal)} {pluralViewers(viewersTotal)}
              </span>
            )}
          </span>
          {mobileChannels ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <AnimatePresence initial={false}>
          {mobileChannels && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-2.5 space-y-2">
                <AddChannelForm onAdd={onAddChannel} toast={toast} />
                {channels.map((c) => (
                  <ChannelCard key={c.id} c={c} onRemove={onRemoveChannel} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>}

      {toolbar}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="scroll-thin h-full overflow-y-auto"
          data-chat-feed
          style={{
            paddingLeft: `${chatFeedPad}px`,
            paddingRight: `${chatFeedPad}px`,
            paddingTop: `${Math.round(chatFeedPad / 2)}px`,
            paddingBottom: `${Math.round(chatFeedPad / 2)}px`,
          }}
        >
          {shown.length === 0 ? (
            isTerm ? (
              <div className="py-16 text-center font-mono text-[12px]" style={{ color: "var(--dw-dim)" }}>
                <div className="mb-2 text-[15px]" style={{ color: "var(--dw-accent)" }}>▌ awaiting stream…</div>
                лента пуста — как только каналы начнут присылать чат, сообщения появятся здесь
              </div>
            ) : (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-dashed" style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}>
                  <WifiOff size={20} />
                </span>
                <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>
                  Лента пуста — сообщения появятся здесь,
                  <br />
                  как только каналы начнут присылать чат.
                </p>
              </div>
            )
          ) : (
            // интервал между строками задаёт настройка rowGap, а не space-y.
            // AnimatePresence с initial=false: анимация появления играет ТОЛЬКО
            // у новых сообщений, старые не мигают при перерисовке ленты.
            <AnimatePresence initial={false}>
              {shown.map((m) => (
                <ChatMessage key={m.id} message={m} viewCfg={viewCfg} variant={variant} />
              ))}
            </AnimatePresence>
          )}
        </div>

        <AnimatePresence>
          {!follow && (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              onClick={resumeScroll}
              className="absolute inset-x-4 bottom-4 z-10 mx-auto flex max-w-fit items-center gap-2 rounded-full border px-4 py-2 text-[11.5px] font-medium backdrop-blur-md transition-colors"
              style={{
                borderColor: "var(--dw-line)",
                background: isStudio ? "rgba(255,255,255,0.9)" : "color-mix(in srgb, var(--dw-panel) 88%, transparent)",
                color: "var(--dw-text)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              }}
            >
              <ChevronsDown size={13} style={{ color: "var(--dw-accent-2)" }} />
              Новые сообщения ниже
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  /* ================= ВЕРСИЯ: ТЕРМИНАЛ (каналы сверху + статус-бар) ================= */
  if (isTerm) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <section className="terminal-deck shrink-0 border-b px-3 py-2" aria-label="Подключённые каналы"
          style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[.1em]" style={{ color: "var(--dw-dim)" }}>Каналы</span>
            <span className="text-[10px] tabular-nums" style={{ color: "var(--dw-dim)" }}>{onlineCount}/{channels.length} в эфире</span>
            <button type="button" onClick={() => onChannelsCollapsed(!channelsCollapsed)}
              aria-expanded={!channelsCollapsed} title={channelsCollapsed ? "Показать каналы" : "Свернуть каналы"}
              className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-[var(--dw-hover)]" style={{ color: "var(--dw-dim)" }}>
              {channelsCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
            <button type="button" onClick={() => setAddOpen(v => !v)} aria-expanded={addOpen}
              className="inline-flex h-6 items-center gap-1 rounded border px-2 text-[10.5px] font-medium"
              style={{ borderColor: "var(--dw-line)", background: addOpen ? "var(--dw-input)" : "transparent", color: "var(--dw-text)" }}>
              {addOpen ? <X size={11} /> : <Plus size={11} />}{addOpen ? "Закрыть" : "Добавить канал"}
            </button>
          </div>
          {!channelsCollapsed && (
            <div className="terminal-channel-grid" data-terminal-grid>
              {channels.map(c => <ChannelCard key={c.id} c={c} onRemove={onRemoveChannel} mono />)}
              {!channels.length && <p className="col-span-full py-2 text-[11px]" style={{ color: "var(--dw-dim)" }}>Добавьте канал по имени пользователя.</p>}
            </div>
          )}
          {addOpen && <div className="mt-2 max-w-md"><AddChannelForm onAdd={onAddChannel} toast={toast} onClose={() => setAddOpen(false)} /></div>}
        </section>

        {sp?.diagnoseNet && (
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)", color: "var(--dw-dim)" }}>
            <button onClick={() => { sp.diagnoseNet?.(); toast("Проверка сети — смотрите ленту"); }} className="inline-flex items-center gap-1.5 transition-colors hover:text-[var(--dw-accent)]" title="Проверить доступ к Twitch, Kick, YouTube и VK">
              <Radio size={11} /> ping platforms
            </button>
          </div>
        )}

        {feedArea}

        <StatusBar speech={speech} channels={channels} viewersTotal={viewersTotal} feedTotal={totalMessages} />
      </div>
    );
  }

  /* ================= ВЕРСИИ: КОМАНДА (слева) / СТУДИЯ (справа) ================= */
  const rail = (
    <aside
      className="hidden shrink-0 flex-col border-r transition-[width] duration-300 md:flex"
      style={{
        width: channelsCollapsed ? 72 : 288,
        borderColor: "var(--dw-line)",
        background: "var(--dw-panel)",
        boxShadow: isStudio ? "1px 0 0 rgba(15,23,42,0.04), 8px 0 30px rgba(15,23,42,0.04)" : "none",
      }}
    >
      <div className={`flex items-center gap-2 pb-1 pt-4 ${channelsCollapsed ? "flex-col px-2" : "justify-between px-4"}`}>
        {!channelsCollapsed && (
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[10px] uppercase tracking-[0.22em] ${isStudio ? "font-sans" : ""}`} style={{ color: "var(--dw-dim)" }}>
              Каналы
            </span>
            <span className="rounded-full px-1.5 py-0.5 font-mono text-[10px]" style={{ background: "var(--dw-input)", color: "var(--dw-dim)" }}>
              {channels.length}
            </span>
            {viewersTotal !== null && (
              <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums" style={{ background: "rgba(74,222,128,0.12)", color: "#16a34a" }} title={`Общий онлайн: ${fmtViewersFull(viewersTotal)} ${pluralViewers(viewersTotal)}`}>
                <Eye size={10} /> {fmtViewers(viewersTotal)}
              </span>
            )}
          </div>
        )}
        <div className={channelsCollapsed ? "flex flex-col gap-1.5" : "flex items-center gap-1.5"}>
          <button
            type="button"
            onClick={() => onChannelsCollapsed(!channelsCollapsed)}
            className="grid h-8 w-8 place-items-center rounded-xl border transition-colors hover:border-[var(--dw-accent)]"
            style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}
            title={channelsCollapsed ? "Показать список каналов" : "Скрыть список каналов"}
          >
            {channelsCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
          <button
            onClick={() => {
              if (channelsCollapsed) onChannelsCollapsed(false);
              setAddOpen((v) => !v);
            }}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl border text-[11.5px] font-semibold transition-all hover:border-[var(--dw-accent)] ${channelsCollapsed ? "h-8 w-8 p-0" : "px-2.5 py-1.5"}`}
            style={{
              borderColor: addOpen ? "var(--dw-accent)" : "var(--dw-line)",
              background: addOpen ? "color-mix(in srgb, var(--dw-accent) 12%, transparent)" : "var(--dw-input)",
              color: addOpen ? "var(--dw-accent-2)" : "var(--dw-text)",
            }}
          >
            {addOpen ? <X size={12} /> : <Plus size={12} />}
            {!channelsCollapsed && "Канал"}
          </button>
        </div>
      </div>

      <div className={`scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto py-3 ${channelsCollapsed ? "px-2" : "px-3"}`}>
        <AnimatePresence initial={false}>
          {addOpen && !channelsCollapsed && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <AddChannelForm onAdd={onAddChannel} toast={toast} onClose={() => setAddOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {channels.length === 0 && !addOpen && !channelsCollapsed && (
          <div className="rounded-2xl border border-dashed px-3 py-6 text-center text-[11.5px] leading-relaxed" style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}>
            Нет подключённых каналов.
            <br />
            Нажмите «+ Канал» и укажите username.
          </div>
        )}

        {channels.map((c) => (
          <ChannelCard key={c.id} c={c} compact={channelsCollapsed} onRemove={onRemoveChannel} />
        ))}
      </div>

      {sp?.diagnoseNet && (
        <div className={`border-t py-2.5 ${channelsCollapsed ? "px-2" : "px-3"}`} style={{ borderColor: "var(--dw-line)" }}>
          <button
            onClick={() => {
              sp.diagnoseNet?.();
              toast("Проверка сети — смотрите ленту");
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-medium transition-colors hover:border-[var(--dw-accent)]"
            style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}
            title="Проверить доступ к Twitch, Kick, YouTube и VK"
          >
            <Radio size={12} /> {!channelsCollapsed && "Проверить сеть"}
          </button>
        </div>
      )}

      <SpeechRail speech={speech} onSpeechEnabledChange={onSpeechEnabledChange} toast={toast} compact={channelsCollapsed} isStudio={isStudio} />
    </aside>
  );

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${variant.layout === "right" ? "flex-row-reverse" : ""}`}>
      {rail}
      {feedArea}
    </div>
  );
}

/* ================= озвучка в рейле ================= */

function SpeechRail({ speech, onSpeechEnabledChange, toast, compact, isStudio }: { speech: SpeechEngine; onSpeechEnabledChange: (e: boolean) => void; toast: (t: string) => void; compact: boolean; isStudio: boolean }) {
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-2 border-t py-3" style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}>
        <button
          onClick={() => {
            onSpeechEnabledChange(!speech.enabled);
            toast(speech.enabled ? "Озвучка выключена" : "Озвучка включена");
          }}
          className="grid h-10 w-10 place-items-center rounded-full border transition-all hover:scale-105"
          style={{
            borderColor: speech.enabled ? "var(--dw-accent)" : "var(--dw-line)",
            background: speech.enabled ? "linear-gradient(135deg, var(--dw-accent), var(--dw-accent-2))" : "var(--dw-input)",
            color: speech.enabled ? "#fff" : "var(--dw-dim)",
            boxShadow: speech.enabled ? "0 0 16px color-mix(in srgb, var(--dw-accent) 45%, transparent)" : "none",
          }}
          title={speech.enabled ? "Озвучка включена" : "Озвучка выключена"}
        >
          <Eq active={speech.enabled && !!speech.now && !speech.paused} />
        </button>
        <span className="font-mono text-[9px]" style={{ color: "var(--dw-dim)" }}>
          {speech.enabled ? "вкл" : "выкл"}
        </span>
      </div>
    );
  }

  return (
    <div className="border-t px-2.5 pb-2.5 pt-2" style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}>
      <div
        className="rounded-2xl border p-2.5"
        style={{
          borderColor: "var(--dw-line)",
          background: isStudio ? "var(--dw-panel2)" : "var(--dw-bg)",
          boxShadow: isStudio ? "0 2px 10px rgba(15,23,42,0.05)" : "none",
        }}
      >
        <div className="mb-2 flex items-center justify-between px-0.5">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.2em]" style={{ color: "var(--dw-dim)" }}>
            Озвучка
          </span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: speech.enabled ? "#4ade80" : "var(--dw-line)", boxShadow: speech.enabled ? "0 0 8px rgba(74,222,128,0.6)" : "none" }} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              onSpeechEnabledChange(!speech.enabled);
              toast(speech.enabled ? "Озвучка выключена" : "Озвучка включена");
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-bold transition-all"
            style={{
              background: speech.enabled ? "linear-gradient(135deg, var(--dw-accent), var(--dw-accent-2))" : "var(--dw-input)",
              color: speech.enabled ? "#fff" : "var(--dw-text)",
              boxShadow: speech.enabled ? "0 2px 14px color-mix(in srgb, var(--dw-accent) 40%, transparent)" : "none",
            }}
          >
            <Eq active={speech.enabled && !!speech.now && !speech.paused} /> {speech.enabled ? "вкл" : "выкл"}
          </button>
          <button disabled={!speech.enabled} onClick={() => speech.setPaused(!speech.paused)} title={speech.paused ? "Продолжить" : "Пауза"} className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40" style={{ background: "var(--dw-input)", color: "var(--dw-dim)" }}>
            {speech.paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          <button disabled={!speech.enabled} onClick={speech.skip} title="Пропустить текущее" className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40" style={{ background: "var(--dw-input)", color: "var(--dw-dim)" }}>
            <SkipForward size={12} />
          </button>
          <button disabled={!speech.queueSize} onClick={() => { speech.clearQueue(); toast("Очередь очищена"); }} title="Очистить очередь" className="grid h-8 w-8 place-items-center rounded-full transition-colors disabled:opacity-40" style={{ background: "var(--dw-input)", color: "var(--dw-dim)" }}>
            <ListX size={12} />
          </button>
        </div>
        <div className="mt-2 flex min-h-[14px] items-center gap-2 px-0.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: speech.now ? "var(--dw-accent-2)" : "var(--dw-line)", boxShadow: speech.now ? "0 0 8px var(--dw-accent)" : "none" }}
          />
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" style={{ color: speech.now ? "var(--dw-text)" : "var(--dw-dim)" }}>
            {speech.now
              ? speech.now.label
              : speech.enabled
              ? `слушаю чат · очередь: ${speech.queueSize}`
              : "озвучка выключена"}
          </span>
          {(speech.queueSize > 0 || speech.skipped > 0) && (
            <span className="shrink-0 font-mono text-[9.5px]" style={{ color: "var(--dw-dim)" }}>
              q{speech.queueSize} · skip {speech.skipped}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* мини-эквалайзер */

