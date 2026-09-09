import { useMemo, useState } from "react";
import { Eye, Gamepad2, Lock, MousePointerClick, Palette, Unlock } from "lucide-react";
import { makeMessage } from "../../lib/core";
import { resolveOverlayLook, WIDGET_EFFECTS, WIDGET_STYLES } from "../../lib/widget";
import type { OverlayConfig, WidgetEffect } from "../../lib/widget";
import { Btn, ColorInput, Label, Panel, Segmented, Select, Slider, Toggle } from "./ui";
import { PlatformBadge } from "../bits";
import { OverlayOnlineBar } from "../OverlayApp";
import { useDonationCurrency } from "../../lib/bridge";
import type { PlatformOnline } from "../../lib/viewers";

function isGameChat(styleId: string): boolean {
  return styleId === "rust" || styleId === "tarkov" || styleId === "wot";
}
function gameStyleClass(styleId: string): string {
  if (styleId === "rust") return "style-rust";
  if (styleId === "tarkov") return "style-tarkov";
  if (styleId === "wot") return "style-wot";
  return "";
}

/* Демо-онлайн для предпросмотра: только подключённые площадки, как и в реальном оверлее.
   DonationAlerts идёт отдельной строкой с суммой донатов за стрим. */
const DEMO_ONLINE: PlatformOnline[] = [
  // DonationAlerts всегда первая площадка в строке оверлея.
  { platform: "donation", viewers: 12450, channels: 1 },
  { platform: "twitch", viewers: 1284, channels: 1 },
  { platform: "youtube", viewers: 15920, channels: 1 },
  { platform: "kick", viewers: 342, channels: 1 },
];

export default function OverlayPanel({
  cfg, onChange, desktop,
}: {
  cfg: OverlayConfig;
  onChange: (patch: Partial<OverlayConfig>) => void;
  desktop: boolean;
}) {
  const [donationCurrency] = useDonationCurrency();
  const [run, setRun] = useState(0);
  const set = (patch: Partial<OverlayConfig>) => onChange(patch);
  const look = useMemo(() => resolveOverlayLook(cfg), [cfg]);

  const demo = useMemo(
    () => [
      { ...makeMessage("twitch"), author: "neon_wolf", text: "ЛЕЕЕЕТС ГОООУ", color: "var(--dw-accent-2)" },
      { ...makeMessage("kick"), author: "vanya_fps", text: "модератор молодец", color: "#69db7c" },
      { ...makeMessage("youtube"), author: "quiet_owl", text: "кто ещё смотрит с телефона?", color: "#ff4e45" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.mode, cfg.fontSize, cfg.style, cfg.effect, run]
  );

  const shown = demo.slice(0, cfg.maxMessages);

  return (
    <div className="settings-page grid min-w-0 gap-5 xl:grid-cols-2" data-settings-page="overlay">
      <div className="min-w-0 space-y-4">
        <Panel title="Управление окном" desc={!desktop ? "Поверх игры работает в desktop-сборке. Здесь — предпросмотр." : undefined}>
          <Toggle label="Показывать оверлей" on={cfg.enabled} onChange={enabled => set({ enabled })} />
          <Toggle label="Пропускать клики в игру" hint="При включении окно не перетаскивается мышью." on={cfg.clickThrough} onChange={clickThrough => set({ clickThrough })} />
          <Toggle label="Зафиксировать позицию" on={cfg.locked} onChange={locked => set({ locked })} />
        </Panel>

        <Panel
          title="Стили оформления"
          desc="Те же пресеты, что и в виджете OBS."
          right={<Palette size={14} style={{ color: "var(--dw-accent-2)" }} />}
          collapsible
        >
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {WIDGET_STYLES.map((s) => {
              if (!s) return null;
              const on = cfg.style === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() =>
                    set({
                      style: s.id,
                      bgOpacity: s.bgOpacity,
                      // игровые HUD-стили (RUST, WoT) сразу получают тонкий контур
                      textOutline: s.recTextOutline ?? 0,
                      textShadow: s.recTextShadow ?? true,
                    })
                  }
                  className="rounded-xl border p-2.5 text-left transition-all"
                  style={{
                    borderColor: on ? "var(--dw-accent)" : "var(--dw-line)",
                    background: on ? "color-mix(in srgb, var(--dw-accent) 7%, transparent)" : "transparent",
                  }}
                >
                  <span className="flex h-7 items-center justify-center gap-1 rounded-lg" style={{ background: s.swatch[0] }}>
                    {s.swatch.map((c, i) => (
                      <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="mt-1.5 block text-[11px] font-semibold" style={{ color: on ? "var(--dw-accent-2)" : "var(--dw-text)" }}>
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Анимация появления" collapsible>
          <Label>Эффект</Label>
          <Select<WidgetEffect>
            value={cfg.effect}
            onChange={(v) => { set({ effect: v }); setRun((n) => n + 1); }}
            options={WIDGET_EFFECTS.map((e) => ({ id: e.id, label: e.label }))}
          />
          <div className="mt-3">
            <Label>Скорость анимации</Label>
            <Slider
              value={cfg.effectDuration}
              min={0.1}
              max={1.2}
              step={0.02}
              onChange={(v) => set({ effectDuration: v })}
              format={(v) => `${v.toFixed(2)}с`}
              color="#22d3ee"
            />
          </div>
        </Panel>

        <Panel title="Текст" collapsible>
          <div className="space-y-3">
            <div>
              <Label>Размер текста</Label>
              <Slider value={cfg.fontSize} min={9} max={26} onChange={(v) => set({ fontSize: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label hint={cfg.textColor ? "своё значение" : "из стиля"}>Цвет текста</Label>
              <ColorInput value={cfg.textColor || look.text} onChange={(v) => set({ textColor: v })} />
            </div>
            <div>
              <Label hint={cfg.nameColor ? "своё значение" : "из стиля"}>Цвет ника</Label>
              <ColorInput value={cfg.nameColor || look.name} onChange={(v) => set({ nameColor: v })} />
            </div>
            <Toggle
              label="Тень под текстом"
              hint="мягкая тень — текст читается на светлом фоне игры"
              on={cfg.textShadow}
              onChange={(v) => set({ textShadow: v })}
            />
            <div>
              <Label>Обводка текста</Label>
              <Slider
                value={cfg.textOutline}
                min={0}
                max={2}
                step={0.25}
                onChange={(v) => set({ textOutline: v })}
                format={(v) => (v === 0 ? "выкл" : `${v}px`)}
              />
              <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Очень тонкий чёрный контур вокруг букв, как в игровых чатах.
              </p>
            </div>
            <Btn variant="ghost" onClick={() => set({ textColor: "", nameColor: "" })}>
              Вернуть цвета стиля
            </Btn>
          </div>
        </Panel>

        <Panel title="Фон и рамка" collapsible>
          <div className="space-y-3">
            <div>
              <Label>Прозрачность подложки</Label>
              <Slider value={cfg.bgOpacity} min={0} max={100} onChange={(v) => set({ bgOpacity: v, bgColor: "" })} format={(v) => `${v}%`} color="#22d3ee" />
              <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                Прозрачным становится только фон — текст сообщений остаётся чётким.
              </p>
            </div>
            <div>
              <Label>Скругление углов</Label>
              <Slider value={cfg.radius} min={0} max={26} onChange={(v) => set({ radius: v })} format={(v) => `${v}px`} />
            </div>
            <div>
              <Label>Фоновое изображение (URL)</Label>
              <input
                value={cfg.bgImage}
                onChange={(e) => set({ bgImage: e.target.value })}
                placeholder="https://… (необязательно)"
                className="h-8 w-full rounded-lg border bg-transparent px-2.5 text-[11.5px] outline-none placeholder:text-[var(--dw-dim)] focus:border-[var(--dw-accent)]"
                style={{ borderColor: "var(--dw-line)" }}
              />
            </div>
            <Toggle
              label="Рамка оверлея"
              hint="выключите, чтобы убрать контур вокруг окна"
              on={cfg.showBorder}
              onChange={(v) => set({ showBorder: v })}
            />
          </div>
        </Panel>

        <Panel title="Содержимое" collapsible>
          <div className="space-y-3">
            <div>
              <Label>Сообщений в ленте</Label>
              <Slider value={cfg.maxMessages} min={2} max={20} onChange={(v) => set({ maxMessages: v })} format={(v) => `${v}`} />
            </div>
            <div>
              <Label>Вид</Label>
              <Segmented
                value={cfg.mode}
                onChange={(v) => set({ mode: v })}
                options={[
                  { id: "compact", label: "Компактная лента" },
                  { id: "widget", label: "Плашки" },
                ]}
              />
            </div>
            <div>
              <Label>Время показа сообщения</Label>
              <Slider
                value={cfg.ttl}
                min={0}
                max={60}
                step={1}
                onChange={(v) => set({ ttl: v })}
                format={(v) => (v === 0 ? "всегда" : `${v} с`)}
              />
              <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--dw-dim)" }}>
                0 — сообщения остаются до конца стрима; иначе исчезают через N секунд.
              </p>
            </div>
            <div>
              <Label>Интервал между сообщениями</Label>
              <Slider
                value={cfg.rowGap}
                min={0}
                max={16}
                step={1}
                onChange={(v) => set({ rowGap: v })}
                format={(v) => (v === 0 ? "вплотную" : `${v}px`)}
              />
            </div>
            <Toggle label="Значок площадки" on={cfg.showPlatform} onChange={(v) => set({ showPlatform: v })} />
            <Toggle label="Время сообщения" on={cfg.showTime} onChange={(v) => set({ showTime: v })} />
            <Toggle
              label="Онлайн площадок"
              hint="внизу оверлея — иконки подключённых площадок и число зрителей; неподключённые не показываются"
              on={cfg.showViewers}
              onChange={(v) => set({ showViewers: v })}
            />
          </div>
        </Panel>
      </div>

      {/* Предпросмотр — всегда раскрыт */}
      <Panel
        title="Предпросмотр"
        desc="Так оверлей выглядит поверх игры."
        right={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px]" style={{ color: "var(--dw-dim)" }}>
              <Eye size={11} /> live
            </span>
            <Btn variant="ghost" onClick={() => setRun((n) => n + 1)}>Повторить</Btn>
          </div>
        }
      >
        <div
          className="relative overflow-hidden rounded-2xl border"
          style={{
            minHeight: 360,
            borderColor: "var(--dw-line)",
            background:
              "radial-gradient(ellipse at 30% 20%, color-mix(in srgb, var(--dw-accent) 18%, transparent), transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(34,211,238,0.12), transparent 50%), #0b0d16",
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[9.5px] text-white/60 backdrop-blur-sm">
            игра · 1920×1080
          </div>

          <div
            className={`absolute right-4 top-10 flex w-[min(100%-2rem,290px)] flex-col overflow-hidden ${gameStyleClass(cfg.style)} ${isGameChat(cfg.style) ? "" : "shadow-2xl"}`}
            style={{
              borderRadius: isGameChat(cfg.style) ? 0 : cfg.radius,
              border: isGameChat(cfg.style)
                ? cfg.style === "tarkov"
                  ? `1px solid ${look.border}`
                  : "none"
                : `1px solid ${look.border}`,
              background: cfg.style === "wot" ? "transparent" : look.background,
              backgroundImage: look.bgImage ? `url("${look.bgImage}")` : undefined,
              backgroundSize: "cover",
              backdropFilter: isGameChat(cfg.style) ? "none" : "blur(8px)",
              opacity: cfg.enabled ? 1 : 0.45,
              fontFamily: look.fontFamily,
              boxShadow: "none",
            }}
          >
            <div className="flex flex-col p-3" style={{ gap: `${cfg.rowGap ?? 6}px` }}>
              {shown.map((m) => (
                <div
                  key={`${m.id}-${run}`}
                  className="ov-msg"
                  style={
                    cfg.mode === "widget"
                      ? isGameChat(cfg.style)
                        ? {
                            borderRadius: 0,
                            border: cfg.style === "tarkov" ? `1px solid ${look.border}` : "none",
                            background: cfg.style === "wot" ? "transparent" : look.background,
                            padding: cfg.style === "tarkov" ? "4px 8px" : "1px 0",
                          }
                        : {
                            borderRadius: Math.max(cfg.radius - 4, 4),
                            border: `1px solid ${look.border}`,
                            background: "rgba(0,0,0,0.18)",
                            padding: "6px 9px",
                          }
                      : undefined
                  }
                >
                  <div className="flex items-start gap-2">
                    {cfg.showTime && !isGameChat(cfg.style) && (
                      <span className="mt-[0.2em] shrink-0 font-mono opacity-60" style={{ fontSize: cfg.fontSize * 0.72, color: look.text }}>23:10</span>
                    )}
                    {cfg.showPlatform && !isGameChat(cfg.style) && (
                      <PlatformBadge glow={look.iconGlow} id={m.platform} size={Math.round(cfg.fontSize * 1.2)} iconSize={Math.round(cfg.fontSize * .8)}
                        radius={look.iconShape === "circle" ? 999 : look.iconShape === "square" ? 2 : 5} />
                    )}
                    <p
                      className="min-w-0 leading-snug"
                      style={{
                        fontSize: cfg.fontSize,
                        color: look.text,
                        fontWeight: look.fontWeight,
                        letterSpacing: look.letterSpacing,
                        textShadow: look.textShadow,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {cfg.style === "wot" && <span className="ov-tag">[Allies] </span>}
                      <span
                        style={{
                          color: look.id === "clean" ? m.color : look.name,
                          fontWeight: look.nameWeight,
                          textShadow: look.nameShadow,
                          textTransform: look.uppercaseName ? "uppercase" : "none",
                        }}
                      >
                        {m.author}
                        <span style={{ opacity: 0.55 }}>:</span>
                      </span>
                      <span className="mr-1.5" />
                      <span>{m.text}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {cfg.showViewers && (
              <OverlayOnlineBar
                items={DEMO_ONLINE}
                donationCurrency={donationCurrency}
                look={look}
                fontSize={cfg.fontSize}
                mode={cfg.mode}
                showBorder={cfg.showBorder}
                radius={cfg.radius}
              />
            )}
          </div>

          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap gap-2">
            <span className="rounded-lg border border-white/10 bg-black/45 px-2.5 py-1 font-mono text-[9.5px] text-white/70 backdrop-blur-sm">
              Ctrl+Shift+G — показать / скрыть
            </span>
            {!cfg.enabled && (
              <span className="rounded-lg border border-red-400/30 bg-red-400/10 px-2.5 py-1 font-mono text-[9.5px] text-red-300 backdrop-blur-sm">
                оверлей выключен
              </span>
            )}
          </div>
        </div>

        {!desktop && (
          <p className="mt-2 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
            В браузере оверлей показан как предпросмотр. Поверх игры он работает в desktop-версии.
          </p>
        )}
      </Panel>
    </div>
  );
}
