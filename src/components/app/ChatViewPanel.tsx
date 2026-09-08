import { useState } from "react";
import { Play } from "lucide-react";
import { DENSITY_PRESETS } from "../../lib/widget";
import type { ChatViewConfig, MessageEffect } from "../../lib/widget";
import { getVariant } from "../../lib/app-variants";
import type { AppVariant } from "../../lib/app-variants";
import type { ChatMsg } from "../../lib/core";
import { PLATFORM_IDS } from "../../lib/core";
import ChatMessage from "./ChatMessage";
import { Btn, Panel, Select, SettingRow, Slider, Toggle } from "./ui";

const EFFECTS: { id: MessageEffect; label: string }[] = [
  { id: "none", label: "Без анимации" }, { id: "fade", label: "Проявление" },
  { id: "slide-up", label: "Снизу" }, { id: "slide-left", label: "Справа" },
  { id: "scale", label: "Масштаб" }, { id: "pop", label: "Быстрый акцент" }, { id: "bounce", label: "Пружина" },
];
const DEMO: ChatMsg[] = PLATFORM_IDS.map((platform, i) => ({
  id: `preview-${platform}`, platform, author: ["neon_wolf", "mila_lav", "КиберДед", "wisp_gg", "luna228"][i],
  color: ["#a78bfa", "#f472b6", "#74c0fc", "#69db7c", "#fb923c"][i], badges: i === 0 ? ["SUB"] : [],
  text: ["Всем привет!", "Отличный стрим", "Какой трек играет?", "Красиво сыграно!", "Привет из чата 👋"][i],
  ts: Date.UTC(2026, 0, 1, 12, 10),
}));

export default function ChatViewPanel({ cfg, onChange, variant = getVariant("command") }: {
  cfg: ChatViewConfig; onChange: (c: ChatViewConfig) => void; variant?: AppVariant;
}) {
  const [previewRun, setPreviewRun] = useState(0);
  const set = (patch: Partial<ChatViewConfig>) => onChange({ ...cfg, ...patch });
  const active = DENSITY_PRESETS.find(p => Object.entries(p.cfg).every(([key, value]) => cfg[key as keyof ChatViewConfig] === value));
  return <div className="settings-page chat-settings" data-settings-page="chatview">
    <div className="chat-settings-grid">
      <div className="min-w-0 space-y-5">
        <Panel title="Интервалы и отступы">
          <SettingRow label="Режим отображения">
            <Select label="Режим отображения сообщений" value={active?.id ?? "custom"}
              options={[...DENSITY_PRESETS.map(p => ({ id: p.id, label: p.label })), ...(!active ? [{ id: "custom", label: "Свой вариант" }] : [])]}
              onChange={id => { const preset = DENSITY_PRESETS.find(p => p.id === id); if (preset) set(preset.cfg); }} />
          </SettingRow>
          <details className="mt-2">
            <summary className="cursor-pointer py-1 text-[11.5px]" style={{ color: "var(--dw-dim)" }}>Точная настройка отступов</summary>
            <SettingRow label="Внутри сообщения"><Slider label="Отступ внутри сообщения" value={cfg.padding} min={0} max={20} onChange={padding => set({ padding })} format={v => `${v} px`} /></SettingRow>
            <SettingRow label="По краям ленты"><Slider label="Поля ленты" value={cfg.feedPadding} min={0} max={32} onChange={feedPadding => set({ feedPadding })} format={v => `${v} px`} /></SettingRow>
            <SettingRow label="Между сообщениями"><Slider label="Интервал между сообщениями" value={cfg.rowGap} min={0} max={14} onChange={rowGap => set({ rowGap })} format={v => `${v} px`} /></SettingRow>
          </details>
        </Panel>
        <Panel title="Текст и оформление" collapsible defaultOpen>
          <SettingRow label="Размер текста"><Slider label="Размер текста ленты" value={cfg.fontSize} min={12} max={24} onChange={fontSize => set({ fontSize })} format={v => `${v} px`} /></SettingRow>
          <Toggle label="Подложка сообщений" on={cfg.bubble} onChange={bubble => set({ bubble })} />
          {cfg.bubble && <>
            <SettingRow label="Стиль подложки"><Select label="Стиль подложки" value={cfg.style} options={[
              { id: "classic", label: "С рамкой" }, { id: "minimal", label: "Минимальный" }, { id: "glass", label: "Полупрозрачный" }, { id: "flat", label: "Плоский" },
            ]} onChange={style => set({ style })} /></SettingRow>
            <SettingRow label="Скругление"><Slider label="Скругление сообщений" value={cfg.radius} min={0} max={18} onChange={radius => set({ radius })} format={v => `${v} px`} /></SettingRow>
          </>}
        </Panel>
        <Panel title="Элементы сообщения" collapsible>
          <Toggle label="Иконка площадки" on={cfg.showPlatform} onChange={showPlatform => set({ showPlatform })} />
          <Toggle label="Время сообщения" on={cfg.showTime} onChange={showTime => set({ showTime })} />
          <Toggle label="Бейджи автора" on={cfg.showBadges} onChange={showBadges => set({ showBadges })} />
        </Panel>
        <Panel title="Анимация" collapsible>
          <SettingRow label="Появление сообщений"><Select label="Эффект появления" value={cfg.messageEffect} options={EFFECTS} onChange={messageEffect => { set({ messageEffect }); setPreviewRun(n => n + 1); }} /></SettingRow>
          {cfg.messageEffect !== "none" && <SettingRow label="Длительность"><Slider label="Длительность анимации" value={cfg.effectDuration} min={.12} max={.9} step={.02} onChange={effectDuration => set({ effectDuration })} format={v => `${v.toFixed(2)} с`} /></SettingRow>}
        </Panel>
      </div>
      <div className="min-w-0">
        <Panel title="Предпросмотр" collapsible defaultOpen right={<Btn title="Повторить анимацию" onClick={() => setPreviewRun(n => n + 1)}><Play size={12} /></Btn>}>
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-[10.5px]" style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}>
              <span>{variant.name}</span><span>{active?.label ?? "Свой вариант"}</span>
            </div>
            <div data-chat-preview className="scroll-thin max-h-[360px] overflow-y-auto" style={{ padding: cfg.feedPadding }}>
              {DEMO.map((message, i) => <ChatMessage key={`${message.id}-${previewRun}`} message={message} viewCfg={cfg} variant={variant} delay={i * .03} />)}
            </div>
          </div>
          <p className="mt-2 text-[10.5px]" style={{ color: "var(--dw-dim)" }}>Тот же вид, что в основной ленте. Изменения применяются сразу.</p>
        </Panel>
      </div>
    </div>
  </div>;
}
