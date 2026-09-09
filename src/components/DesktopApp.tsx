import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AudioWaveform, ExternalLink, HeartHandshake, Minus, Settings, Square, Terminal, Video, X,
} from "lucide-react"

import ChatPanel from "./app/ChatPanel";
import VoicePanel from "./app/VoicePanel";
import FiltersPanel from "./app/FiltersPanel";
import ChatViewPanel from "./app/ChatViewPanel";
import WidgetPanel from "./app/WidgetPanel";
import OverlayPanel from "./app/OverlayPanel";
import HotkeysPanel from "./app/HotkeysPanel";
import ChatBotPanel from "./app/ChatBotPanel";
import { Toggle } from "./app/ui";
import SettingsShell from "./app/SettingsShell";
import type { SettingsTabId } from "./app/SettingsShell";
import {
  getSp, isDesktop, useChatSource, useHotkeys, usePersisted, useSetting,
  useWidgetInfo, useWindowMaximized,
} from "../lib/bridge";
import type { Channel } from "../lib/bridge";
import { useSpeechEngine } from "../lib/core";
import type { ChatMsg } from "../lib/core";
import { DEFAULT_TTS, sanitizeTts } from "../lib/tts-config";
import type { TtsConfig } from "../lib/tts-config";
import {
  DEFAULT_CHAT_VIEW, DEFAULT_HOTKEYS, DEFAULT_OVERLAY, DEFAULT_WIDGET, buildWidgetUrl,
} from "../lib/widget";
import type { ChatViewConfig, OverlayConfig, WidgetConfig } from "../lib/widget";
import { APP_TAG, APP_VERSION } from "../version";
import { APP_VARIANTS, getVariant } from "../lib/app-variants";
import { TwitchIcon, YoutubeIcon } from "./brands";
import { Eq } from "./bits";
import { useModerate } from "../lib/bridge";
import { isEventShown } from "../lib/feed-events";

const MAX_FEED = 300;

/* ---------- варианты интерфейса: src/lib/app-variants.ts ---------- */
/* ---------- вкладки настроек и их группы: ./app/SettingsShell ---------- */

export default function DesktopApp() {
  const sp = getSp();
  const desktop = isDesktop();

  const [feed, setFeed] = useState<ChatMsg[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("voice");

  /* ---------- уведомления ---------- */
  const [toastText, setToastText] = useState("");
  const toastTimer = useRef(0);
  const toast = useCallback((t: string) => {
    setToastText(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(""), 2400);
  }, []);

  /* ---------- настройки: сохраняются мгновенно, без кнопки «Сохранить» ---------- */
  const [tts, setTts] = usePersisted<TtsConfig>("tts", DEFAULT_TTS);
  const [chatView, setChatView] = usePersisted<ChatViewConfig>("chatView", DEFAULT_CHAT_VIEW);
  const [widgetCfg, setWidgetCfg] = usePersisted<WidgetConfig>("widget", DEFAULT_WIDGET);
  const [hotkeys, setHotkeys] = usePersisted<Record<string, string>>("hotkeys", DEFAULT_HOTKEYS);
  const [variantId, setVariantId] = useSetting<string>("variant", "command");
  const variant = useMemo(() => getVariant(variantId), [variantId]);

  /* FIX: «Сворачивать в трей при закрытии» — реальная настройка, а не заглушка */
  const [closeToTray, setCloseToTray] = useSetting<boolean>("closeToTray", false);
  const [minimizeToTray, setMinimizeToTray] = useSetting<boolean>("minimizeToTray", false);
  const [startHidden, setStartHidden] = useSetting<boolean>("startHidden", false);
  const [channelsCollapsed, setChannelsCollapsed] = useSetting<boolean>("channelsCollapsed", false);
  const [menuCollapsed, setMenuCollapsed] = useSetting<boolean>("menuCollapsed", false);
  /* Модерация из ленты (бан / таймаут через чат-бота). */
  const moderateMessage = useModerate(toast);

  const [savedAt, setSavedAt] = useState(0);
  const savedTimer = useRef(0);
  const markSaved = useCallback(
    (label?: string) => {
      setSavedAt(Date.now());
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedAt(0), 1900);
      if (label) toast(label);
    },
    [toast]
  );

  const ttsSafe = useMemo(() => sanitizeTts(tts), [tts]);
  const patchTts = useCallback(
    (patch: Partial<TtsConfig>) => {
      setTts({ ...sanitizeTts(tts), ...patch });
      markSaved();
    },
    [tts, setTts, markSaved]
  );

  const patchChatView = useCallback(
    (c: ChatViewConfig) => {
      setChatView(c);
      markSaved();
    },
    [setChatView, markSaved]
  );

  const patchWidget = useCallback(
    (c: WidgetConfig) => {
      setWidgetCfg(c);
      markSaved();
    },
    [setWidgetCfg, markSaved]
  );

  const patchHotkeys = useCallback(
    (map: Record<string, string>) => {
      setHotkeys(map);
      sp?.hotkeys.apply(map);
      markSaved();
    },
    [setHotkeys, sp, markSaved]
  );

  /* ---------- оверлей: живёт в settings.json через отдельный IPC-канал ---------- */
  const [overlay, setOverlayState] = useState<OverlayConfig>(DEFAULT_OVERLAY);
  useEffect(() => {
    if (!sp) {
      try {
        const raw = localStorage.getItem("yawa:overlay");
        if (raw) setOverlayState({ ...DEFAULT_OVERLAY, ...JSON.parse(raw) });
      } catch { /* noop */ }
      return;
    }
    sp.overlay.get().then((o) => o && setOverlayState({ ...DEFAULT_OVERLAY, ...o }));
    sp.overlay.onChange((o) => setOverlayState({ ...DEFAULT_OVERLAY, ...o }));
  }, [sp]);

  const patchOverlay = useCallback(
    (patch: Partial<OverlayConfig>) => {
      setOverlayState((cur) => {
        const next = { ...cur, ...patch };
        if (sp) sp.overlay.set(patch);
        else {
          try {
            localStorage.setItem("yawa:overlay", JSON.stringify(next));
          } catch { /* noop */ }
        }
        return next;
      });
      markSaved();
    },
    [sp, markSaved]
  );

  /* ---------- окно ---------- */
  const maximized = useWindowMaximized();
  const widgetInfo = useWidgetInfo();
  const widgetUrl = useMemo(
    () => widgetInfo.url || buildWidgetUrl(widgetCfg, widgetInfo.port, widgetInfo.token),
    [widgetCfg, widgetInfo.port, widgetInfo.token, widgetInfo.url]
  );

  /* ---------- чат и озвучка ---------- */
  const speech = useSpeechEngine();
  const speechRef = useRef(speech);
  speechRef.current = speech;

  /* Лента: перед добавлением проверяем, включено ли событие в «Лента → События». */
  const eventsRef = useRef(chatView.events);
  eventsRef.current = chatView.events;

  const push = useCallback((m: ChatMsg) => {
    if (!isEventShown(eventsRef.current, m.kind)) return;
    setFeed((prev) => (prev.length > MAX_FEED ? [...prev.slice(-MAX_FEED), m] : [...prev, m]));
    speechRef.current.enqueue(m);
  }, []);

  const { channels, addChannel, removeChannel } = useChatSource(push);

  /* применение сохранённых настроек озвучки к движку (и наоборот — мгновенное сохранение) */
  useEffect(() => {
    speech.setRate(ttsSafe.rate);
    speech.setVolume(ttsSafe.volume);
    speech.setTemplate(ttsSafe.template);
    speech.setFilters(ttsSafe.filters);
    speech.setObsTts(ttsSafe.obsTts);
    speech.setAlsoLocal(ttsSafe.alsoLocal);
    if (ttsSafe.voiceURI) speech.setVoiceURI(ttsSafe.voiceURI);
    // Раньше сюда уходило { tts: ttsSafe }. Виджет-сервер сохранял это как
    // «последнее оформление», и заново подключившийся OBS получал служебный
    // объект вместо стилей. Настройки озвучки виджету не нужны: он получает
    // готовое аудио отдельным каналом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSafe]);

  /* Синхронизация после асинхронной загрузки settings.json.
   * Раньше эффект выполнялся только при первом рендере, до загрузки настройки,
   * поэтому состояние кнопки и движка расходилось и сообщения не озвучивались. */
  useEffect(() => {
    // Включаем/выключаем движок сразу при изменении настройки — без таймера,
    // чтобы первое же сообщение после включения уже было озвучено.
    speech.setEnabled(ttsSafe.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSafe.enabled]);

  const setSpeechEnabled = useCallback(
    (enabled: boolean) => {
      patchTts({ enabled });
      speech.setEnabled(enabled);
    },
    [patchTts, speech]
  );

  const toggleTts = useCallback(() => {
    const next = !ttsSafe.enabled;
    setSpeechEnabled(next);
    toast(next ? "Озвучка включена" : "Озвучка выключена");
  }, [ttsSafe.enabled, setSpeechEnabled, toast]);

  /**
   * Отключение озвучки конкретного зрителя прямо из ленты.
   * Пишем в тот же список, что и раздел «Фильтры → Авторы», поэтому
   * действие видно в настройках и сохраняется между запусками.
   */
  const toggleMuteAuthor = useCallback(
    (author: string, mute: boolean) => {
      const name = author.trim().toLowerCase();
      if (!name) return;
      const current = ttsSafe.filters.banAuthors ?? [];
      const already = current.some((a) => a.toLowerCase() === name);
      if (mute === already) return;
      const banAuthors = mute
        ? [...current, name]
        : current.filter((a) => a.toLowerCase() !== name);
      patchTts({ filters: { ...ttsSafe.filters, banAuthors } });
      toast(mute ? `${author}: озвучка выключена` : `${author}: озвучка включена`);
    },
    [ttsSafe.filters, patchTts, toast]
  );

  const clearFeed = useCallback(() => {
    setFeed([]);
    toast("Лента очищена");
  }, [toast]);

  useHotkeys({
    "tts:toggle": toggleTts,
    "tts:pause": () => speechRef.current.setPaused(!speechRef.current.paused),
    "tts:skip": () => speechRef.current.skip(),
    "tts:clear": () => {
      speechRef.current.clearQueue();
      toast("Очередь очищена");
    },
    "feed:clear": clearFeed,
  });

  /* Причина, по которой звука нет в OBS: подсказка вместо тишины.
     Показываем один раз на состояние, чтобы не спамить уведомлениями. */
  const lastObsWarn = useRef("");
  useEffect(() => {
    const bridge = getSp();
    if (!bridge?.onObsTts) return;
    bridge.onObsTts((msg) => {
      const state = msg?.state;
      if (!state || state === "played" || state === "unblocked") {
        lastObsWarn.current = "";
        return;
      }
      if (lastObsWarn.current === state) return;
      lastObsWarn.current = state;
      const hint: Record<string, string> = {
        blocked: "OBS заблокировал автовоспроизведение. Откройте свойства Browser Source и нажмите «Обновить».",
        "no-voice": "В OBS нет голосов для синтеза. Выберите вывод «Этот компьютер и OBS».",
        "no-client": "Виджет OBS не подключён — добавьте Browser Source со ссылкой из настроек.",
        error: "OBS не смог проиграть озвучку.",
      };
      if (hint[state]) toast(hint[state]);
    });
  }, [toast]);

  /* ---------- интерфейс ---------- */
  const onlineCount = channels.filter((c) => c.status === "online").length;
  const onlineViewers = channels.reduce(
    (sum, c) => sum + (typeof c.viewers === "number" && Number.isFinite(c.viewers) ? (c.viewers as number) : 0),
    0
  );
  const feedTotal = feed.filter((m) => !m.sys).length;

  return (
    <div
      className={`dw ${variant.light ? "light" : ""} flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[inherit]`}
      style={{
        ...(variant.vars as React.CSSProperties),
        ...(variant.mono ? { fontFamily: "'JetBrains Mono', ui-monospace, 'Consolas', monospace" } : {}),
      } as React.CSSProperties}
    >
      {/* ================= шапка окна ================= */}
      <header
        className="flex shrink-0 items-center gap-3 border-b px-3 py-2.5 sm:px-4"
        style={{
          borderColor: "var(--dw-line)",
          background: "var(--dw-panel)",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        {/* бренд + живой статус */}
        <div className="flex min-w-0 items-center gap-3">
          {variant.id === "terminal" ? (
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
              style={{
                background: "color-mix(in srgb, var(--dw-accent) 14%, transparent)",
                color: "var(--dw-accent)",
                boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--dw-accent) 45%, transparent)",
              }}
            >
              <Terminal size={16} />
            </span>
          ) : (
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center text-white ${variant.id === "studio" ? "rounded-2xl" : "rounded-[12px]"}`}
              style={{
                background: "linear-gradient(135deg,var(--dw-accent) 0%,var(--dw-accent-2) 100%)",
                boxShadow: "0 4px 20px color-mix(in srgb, var(--dw-accent) 35%, transparent)",
              }}
            >
              <AudioWaveform size={17} strokeWidth={2.6} />
            </span>
          )}
          <div className="min-w-0">
            {variant.id === "terminal" ? (
              <div className="truncate font-mono text-[13px] font-bold leading-none tracking-[0.08em]" style={{ color: "var(--dw-text)" }}>
                YAWACHAT_HUB
                <span className="ml-0.5 animate-caret" aria-hidden="true" style={{ color: "var(--dw-accent)" }}>▌</span>
              </div>
            ) : (
              <div className="truncate text-[13.5px] font-bold leading-none tracking-tight">
                <span style={{ color: "var(--dw-text)" }}>YawaChatHub</span>
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: onlineCount > 0 ? "#4ade80" : "var(--dw-dim)",
                  boxShadow: onlineCount > 0 ? "0 0 8px rgba(74,222,128,0.7)" : "none",
                }}
              />
              <span
                className="font-mono text-[9.5px] uppercase tracking-[0.14em]"
                style={{ color: onlineCount > 0 ? (variant.id === "studio" ? "#16a34a" : "#4ade80") : "var(--dw-dim)" }}
              >
                {onlineCount > 0 ? `${onlineCount} в эфире · ${onlineViewers.toLocaleString("ru-RU")} зрителей` : "нет эфира"}
              </span>
            </div>
          </div>
        </div>

        {/* переключатель варианта интерфейса */}
        <div
          className="hidden items-center gap-1 rounded-full border p-1 lg:flex"
          style={{ borderColor: "var(--dw-line)", background: "var(--dw-input)" }}
          title="Вариант интерфейса"
        >
          {APP_VARIANTS.map((v) => {
            const Icon = v.icon;
            const on = variant.id === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                title={`${v.name} — ${v.desc}`}
                className="grid h-6 w-7 place-items-center rounded-full transition-all"
                style={{
                  background: on ? "linear-gradient(135deg, var(--dw-accent), var(--dw-accent-2))" : "transparent",
                  color: on ? "#fff" : "var(--dw-dim)",
                  boxShadow: on ? "0 2px 10px color-mix(in srgb, var(--dw-accent) 40%, transparent)" : "none",
                }}
              >
                <Icon size={12} />
              </button>
            );
          })}
        </div>

        {/* быстрый тумблер озвучки */}
        <button
          type="button"
          onClick={toggleTts}
          title={ttsSafe.enabled ? "Озвучка включена — выключить" : "Озвучка выключена — включить"}
          className="ml-auto hidden items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-bold transition-all hover:border-[var(--dw-accent)] sm:inline-flex"
          style={{
            borderColor: ttsSafe.enabled ? "color-mix(in srgb, var(--dw-accent) 40%, transparent)" : "var(--dw-line)",
            background: ttsSafe.enabled ? "color-mix(in srgb, var(--dw-accent) 10%, transparent)" : "var(--dw-input)",
            color: ttsSafe.enabled ? "var(--dw-text)" : "var(--dw-dim)",
          }}
        >
          {/* Иконка всегда одна и та же: меняется только анимация и цвет.
              Подмена Volume2/Eq в зависимости от speech.now вызывала мигание
              шапки при каждом входе и выходе фразы. */}
          <Eq
            color={ttsSafe.enabled ? "var(--dw-accent)" : "var(--dw-dim)"}
            active={ttsSafe.enabled && !speech.paused && !!speech.now}
            size={13}
          />
          <span className={ttsSafe.enabled ? "" : "opacity-70"}>
            {ttsSafe.enabled ? "озвучка вкл" : "озвучка выкл"}
          </span>
        </button>

        {/* сообщений в ленте */}
        <span
          className="hidden rounded-full px-2.5 py-1 font-mono text-[10px] tabular-nums md:inline-flex"
          style={{ background: "var(--dw-input)", color: "var(--dw-dim)" }}
          title="Сообщений в ленте"
        >
          {feedTotal} msg
        </span>

        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            title={settingsOpen ? "Закрыть настройки" : "Настройки"}
            className="grid h-9 w-9 place-items-center rounded-[12px] border transition-all hover:scale-105"
            style={{
              borderColor: settingsOpen ? "var(--dw-accent)" : "var(--dw-line)",
              background: settingsOpen ? "color-mix(in srgb, var(--dw-accent) 10%, transparent)" : "var(--dw-input)",
              color: settingsOpen ? "var(--dw-accent-2)" : "var(--dw-dim)",
              boxShadow: settingsOpen ? "0 0 16px color-mix(in srgb, var(--dw-accent) 25%, transparent)" : "none",
            }}
          >
            {settingsOpen ? <X size={15} /> : <Settings size={15} />}
          </button>
          {desktop && (
            <>
              <button
                type="button"
                onClick={() => sp?.window.minimize()}
                title={minimizeToTray ? "Свернуть в трей" : "Свернуть"}
                className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[var(--dw-hover)]"
                style={{ color: "var(--dw-dim)" }}
              >
                <Minus size={12} />
              </button>
              <button
                type="button"
                onClick={() => sp?.window.toggleMaximize()}
                title="Во весь экран"
                className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[var(--dw-hover)]"
                style={{ color: "var(--dw-dim)" }}
              >
                <Square size={10} strokeWidth={maximized ? 3 : 1.8} />
              </button>
              <button
                type="button"
                onClick={() => sp?.window.close()}
                title={closeToTray ? "Свернуть в трей" : "Закрыть приложение"}
                className="grid h-7 w-7 place-items-center rounded-full transition-colors hover:bg-[rgba(248,113,113,0.25)] hover:text-red-400"
                style={{ color: "var(--dw-dim)" }}
              >
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* ================= тело ================= */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <ChatPanel
          feed={feed}
          channels={channels}
          speech={speech}
          viewCfg={chatView}
          variant={variant}
          mutedAuthors={ttsSafe.filters.banAuthors}
          onToggleMuteAuthor={toggleMuteAuthor}
          channelsCollapsed={channelsCollapsed}
          onChannelsCollapsed={setChannelsCollapsed}
          onSpeechEnabledChange={setSpeechEnabled}
          onClear={clearFeed}
          onAddChannel={addChannel}
          onRemoveChannel={removeChannel}
          toast={toast}
          onModerate={moderateMessage}
        />

        <AnimatePresence>
          {settingsOpen && (
            <motion.div
              initial={{ opacity: 0, y: 26, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 26, scale: 0.985 }}
              transition={{ duration: 0.3, ease: [0.22, 0.36, 0, 1] }}
              className="absolute inset-2 z-30 flex min-w-0 flex-col overflow-hidden rounded-2xl border sm:inset-3 sm:rounded-3xl sm:flex-row"
              style={{
                background: "var(--dw-panel)",
                borderColor: "var(--dw-line)",
                boxShadow: "0 40px 120px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.04)",
              }}
            >
              <SettingsShell
                active={settingsTab}
                onSelect={setSettingsTab}
                savedAt={savedAt}
                onClose={() => setSettingsOpen(false)}
                collapsed={menuCollapsed}
                onToggleCollapsed={() => setMenuCollapsed(!menuCollapsed)}
              >

                {settingsTab === "voice" && (
                  <VoicePanel
                    speech={speech}
                    cfg={ttsSafe}
                    onChange={patchTts}
                    toast={toast}
                    onOpenFilters={() => setSettingsTab("filters")}
                  />
                )}
                {settingsTab === "filters" && (
                  <FiltersPanel cfg={ttsSafe} onChange={patchTts} toast={toast} />
                )}
                {settingsTab === "chatview" && (
                  <ChatViewPanel cfg={chatView} onChange={patchChatView} variant={variant} />
                )}
                {settingsTab === "widget" && (
                  <WidgetPanel
                    cfg={widgetCfg}
                    onChange={patchWidget}
                    url={widgetUrl}
                    clients={widgetInfo.clients}
                    toast={toast}
                  />
                )}
                {settingsTab === "overlay" && (
                  <OverlayPanel cfg={overlay} onChange={patchOverlay} desktop={desktop} />
                )}
                {settingsTab === "hotkeys" && (
                  <HotkeysPanel hotkeys={hotkeys} onChange={patchHotkeys} desktop={desktop} toast={toast} />
                )}
                {settingsTab === "bot" && (
                  <ChatBotPanel toast={toast} />
                )}

                {settingsTab === "interface" && (
                  <div className="mx-auto max-w-4xl space-y-4">
                    <div
                      className="rounded-2xl border p-4"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <h3 className="text-[13px] font-semibold">Вариант интерфейса</h3>
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                        Три полностью разных сценария. Применяется мгновенно и запоминается.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {APP_VARIANTS.map((th) => {
                          const on = variant.id === th.id;
                          const Icon = th.icon;
                          return (
                            <button
                              key={th.id}
                              onClick={() => {
                                setVariantId(th.id);
                                markSaved(`Вариант: ${th.name}`);
                              }}
                              className="flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all"
                              style={{
                                borderColor: on ? "var(--dw-accent)" : "var(--dw-line)",
                                background: on ? "color-mix(in srgb, var(--dw-accent) 9%, transparent)" : "var(--dw-panel2)",
                                boxShadow: on ? "0 0 18px color-mix(in srgb, var(--dw-accent) 22%, transparent)" : "none",
                              }}
                            >
                              <span
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                                style={{
                                  background: on ? "linear-gradient(135deg, var(--dw-accent), var(--dw-accent-2))" : "var(--dw-input)",
                                  color: on ? "#fff" : "var(--dw-dim)",
                                }}
                              >
                                <Icon size={15} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold" style={{ color: on ? "var(--dw-accent-2)" : "var(--dw-text)" }}>
                                  {th.name}
                                </span>
                                <span className="mt-0.5 block text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                                  {th.desc}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="rounded-2xl border p-4"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <h3 className="text-[13px] font-semibold">Поведение окна</h3>
                      <p className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                        Переключатели работают сразу — перезапуск не требуется.
                      </p>
                      <div className="mt-2 space-y-1">
                        <Toggle
                          label="Сворачивать в трей при закрытии"
                          hint={
                            desktop
                              ? "крестик прячет окно в трей; выключено — приложение завершается"
                              : "настройка применится в desktop-сборке (settings.json → closeToTray)"
                          }
                          on={closeToTray}
                          onChange={(v) => {
                            setCloseToTray(v);
                            markSaved(v ? "Закрытие: сворачивать в трей" : "Закрытие: выход из приложения");
                          }}
                        />
                        <Toggle
                          label="Сворачивать в трей кнопкой «минус»"
                          hint="обычное поведение — свернуть на панель задач"
                          on={minimizeToTray}
                          onChange={(v) => {
                            setMinimizeToTray(v);
                            markSaved();
                          }}
                        />
                        <Toggle
                          label="Запускать свёрнутым в трей"
                          hint="окно не появляется при старте — открыть можно из трея"
                          on={startHidden}
                          onChange={(v) => {
                            setStartHidden(v);
                            markSaved();
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === "about" && (
                  <div className="mx-auto max-w-2xl space-y-4">
                    <div
                      className="rounded-2xl border p-5"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
                          style={{
                            background: "linear-gradient(135deg,var(--dw-accent) 0%,#22d3ee 100%)",
                            boxShadow: "0 0 22px color-mix(in srgb, var(--dw-accent) 40%, transparent)",
                          }}
                        >
                          <AudioWaveform size={21} strokeWidth={2.4} />
                        </span>
                        <div>
                          <h3 className="font-display text-lg font-bold leading-none">
                            <span style={{ color: "var(--dw-text)" }}>Yawa</span>
                            <span
                              className="mx-1 inline-block rounded-md px-1.5 py-0.5 align-middle text-[13px] leading-none"
                              style={{
                                color: "#fff",
                                background: "linear-gradient(135deg,var(--dw-accent) 0%,#22d3ee 100%)",
                                boxShadow: "0 0 10px color-mix(in srgb, var(--dw-accent) 50%, transparent), inset 0 0 0 1px rgba(255,255,255,0.2)",
                                textShadow: "0 1px 1px rgba(0,0,0,0.35)",
                              }}
                            >Chat</span>
                            <span style={{ color: "var(--dw-dim)" }}>Hub</span>
                          </h3>
                          <p className="mt-1 font-mono text-[10.5px]" style={{ color: "var(--dw-dim)" }}>
                            {APP_TAG} · текущая версия {APP_VERSION}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 text-[12.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>
                        Единая лента сообщений Twitch, YouTube Live, VK Play Live, Kick и TikTok Live с озвучкой,
                        виджетом для OBS и игровым оверлеем.
                      </p>

                    </div>

                    {/* Поддержи автора */}
                    <div
                      className="rounded-2xl border p-5"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <div className="text-[12.5px] font-semibold" style={{ color: "var(--dw-text)" }}>
                        Поддержи автора
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>
                        Если YawaChatHub экономит тебе время и нервы на стриме — можно угостить
                        разработчика чаем. Любая поддержка помогает обновлять платформу.
                      </p>
                      <a
                        href="https://www.donationalerts.com/r/yawaside"
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-transform hover:scale-[1.01]"
                        style={{
                          borderColor: "#fb6c2a",
                          background: "linear-gradient(135deg, rgba(251,108,42,0.16) 0%, rgba(255,154,69,0.06) 100%)",
                          boxShadow: "inset 0 0 0 1px rgba(251,108,42,0.25)",
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="grid h-9 w-9 place-items-center rounded-lg text-white"
                            style={{ background: "linear-gradient(135deg,#fb6c2a 0%,#ff9a45 100%)" }}
                          >
                            <HeartHandshake size={17} />
                          </span>
                          <div>
                            <div className="text-[12.5px] font-semibold" style={{ color: "var(--dw-text)" }}>
                              DonationAlerts · yawaside
                            </div>
                            <div className="font-mono text-[10.5px]" style={{ color: "var(--dw-dim)" }}>
                              donationalerts.com/r/yawaside
                            </div>
                          </div>
                        </div>
                        <ExternalLink size={14} style={{ color: "var(--dw-dim)" }} />
                      </a>
                    </div>

                    {/* Где меня смотреть */}
                    <div
                      className="rounded-2xl border p-5"
                      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}
                    >
                      <div className="text-[12.5px] font-semibold" style={{ color: "var(--dw-text)" }}>
                        Смотри меня на
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <a
                          href="https://www.youtube.com/@YAWASIDE"
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors hover:border-[#ff4e45]"
                          style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}
                        >
                          <YoutubeIcon size={18} className="shrink-0" style={{ color: "#ff4e45" }} />
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold" style={{ color: "var(--dw-text)" }}>YouTube</div>
                            <div className="truncate font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>@YAWASIDE</div>
                          </div>
                          <ExternalLink size={12} className="ml-auto shrink-0" style={{ color: "var(--dw-dim)" }} />
                        </a>
                        <a
                          href="https://www.twitch.tv/yawaside_"
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors hover:border-[#a970ff]"
                          style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}
                        >
                          <TwitchIcon size={18} className="shrink-0" style={{ color: "#a970ff" }} />
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold" style={{ color: "var(--dw-text)" }}>Twitch</div>
                            <div className="truncate font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>yawaside_</div>
                          </div>
                          <ExternalLink size={12} className="ml-auto shrink-0" style={{ color: "var(--dw-dim)" }} />
                        </a>
                        <a
                          href="https://live.vkvideo.ru/yawaside"
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors hover:border-[#4c8dff]"
                          style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}
                        >
                          <Video size={18} className="shrink-0" style={{ color: "#4c8dff" }} />
                          <div className="min-w-0">
                            <div className="text-[11.5px] font-semibold" style={{ color: "var(--dw-text)" }}>VK Video Live</div>
                            <div className="truncate font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>/yawaside</div>
                          </div>
                          <ExternalLink size={12} className="ml-auto shrink-0" style={{ color: "var(--dw-dim)" }} />
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </SettingsShell>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ================= уведомление ================= */}
      <AnimatePresence>
        {toastText && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl border px-4 py-2 text-[12px] font-medium shadow-2xl"
            style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)", color: "var(--dw-text)" }}
          >
            {toastText}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export type { Channel };
