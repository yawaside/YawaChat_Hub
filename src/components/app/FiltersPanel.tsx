import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, FlaskConical, Globe2, ShieldCheck } from "lucide-react";
import { applyPreset, BAN_PRESETS, buildSpeechText, isPresetApplied, unapplyPreset, PLATFORMS, PLATFORM_IDS, uniqueFilterEntries } from "../../lib/core";
import type { BanPreset, PlatformId, TTSFilters } from "../../lib/core";
import type { TtsConfig } from "../../lib/tts-config";
import { PlatformIcon } from "../bits";
import { Btn, Panel, Select, SettingRow, Slider, TagInput, Toggle } from "./ui";

type SectionId = "presets" | "words" | "authors" | "processing" | "test";
type Scope = PlatformId | "all";
const SCOPES: Scope[] = ["all", ...PLATFORM_IDS];
const SCOPE_NAMES: Record<Scope, string> = { all: "Общие", twitch: "Twitch", youtube: "YouTube", kick: "Kick", tiktok: "TikTok", vk: "VK Live" };
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "presets", label: "Пресеты" }, { id: "words", label: "Свои слова" },
  { id: "authors", label: "Авторы" }, { id: "processing", label: "Обработка" }, { id: "test", label: "Проверка" },
];

function PresetRow({ preset, active, onToggle }: { preset: BanPreset; active: boolean; onToggle: () => void }) {
  const count = uniqueFilterEntries(preset.words).length + uniqueFilterEntries(preset.mask).length + uniqueFilterEntries(preset.authors).length;
  return <div className="preset-row" data-preset-id={preset.id} data-enabled={active}>
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" aria-hidden="true"
      style={{ background: active ? "rgba(34,197,135,.12)" : "var(--dw-input)", color: active ? "#2bb482" : "var(--dw-dim)" }}>
      {active ? <Check size={17} strokeWidth={2.5} /> : <ShieldCheck size={16} />}
    </span>
    <div className="min-w-0 flex-1">
      <h4 className="text-[12px] font-semibold">{preset.label}</h4>
      <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>{preset.desc}</p>
      <details className="mt-1.5 text-[10.5px]" style={{ color: "var(--dw-dim)" }}>
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 hover:text-[var(--dw-text)]"><ChevronDown size={11} />{count} правил · посмотреть</summary>
        <div className="scroll-thin mt-2 max-h-36 space-y-2 overflow-y-auto rounded-md p-2" style={{ background: "var(--dw-input)" }}>
          {[{ label: "Пропуск сообщения", items: preset.words }, { label: "Замена на «пип»", items: preset.mask ?? [] }, { label: "Игнор авторов", items: preset.authors ?? [] }].filter(g => g.items.length).map(g => (
            <div key={g.label}><span className="font-semibold">{g.label}: </span><span className="break-words">{uniqueFilterEntries(g.items).join(", ")}</span></div>
          ))}
        </div>
      </details>
    </div>
    <button type="button" role="switch" aria-label={`Пресет: ${preset.label}`} aria-checked={active} onClick={onToggle} className="preset-state">
      <span className="preset-state-label">{active ? "Включён" : "Выключен"}</span>
      <span className="relative h-5 w-9 rounded-full transition-colors" aria-hidden="true" style={{ background: active ? "#229b73" : "var(--dw-scroll)" }}>
        <span className="absolute left-[3px] top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: `translateX(${active ? 16 : 0}px)` }} />
      </span>
    </button>
  </div>;
}

export default function FiltersPanel({ cfg, onChange, toast }: {
  cfg: TtsConfig; onChange: (patch: Partial<TtsConfig>) => void; toast: (t: string) => void;
}) {
  const f = cfg.filters;
  const set = (patch: Partial<TTSFilters>) => onChange({ filters: { ...f, ...patch } });
  const [section, setSection] = useState<SectionId>("presets");
  const [scope, setScope] = useState<Scope>("twitch");
  const uid = useId();
  const appliedCount = useMemo(() => BAN_PRESETS.filter(p => isPresetApplied(p, f)).length, [f]);
  const presets = BAN_PRESETS.filter(p => (p.platform ?? "all") === scope);
  const scopeCount = presets.filter(p => isPresetApplied(p, f)).length;
  const [testAuthor, setTestAuthor] = useState("neon_wolf");
  const [testPlatform, setTestPlatform] = useState<PlatformId>("twitch");
  const [testText, setTestText] = useState("привет из чата!");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setResult(null); }, [testText, testAuthor, testPlatform, f, cfg.template]);
  const runTest = () => {
    const text = buildSpeechText({ id: "filter-test", platform: testPlatform, author: testAuthor.trim() || "зритель", color: "#fff", badges: [], text: testText, ts: Date.now() }, cfg.template, f, new Map());
    setResult(text ? { ok: true, text } : { ok: false, text: "Сообщение не будет озвучено: сработал фильтр." });
  };
  return <div className="settings-page" data-settings-page="filters">
    <div className="settings-section-tabs" role="tablist" aria-label="Разделы фильтров">
      {SECTIONS.map(s => <button key={s.id} type="button" role="tab" id={`${uid}-${s.id}`} aria-controls={`${uid}-content`} aria-selected={section === s.id} onClick={() => setSection(s.id)}>
        {s.label}{s.id === "presets" && appliedCount > 0 && <span className="ml-1.5 rounded px-1 text-[10px]" style={{ background: "var(--dw-input)" }}>{appliedCount}</span>}
      </button>)}
    </div>
    <div id={`${uid}-content`} role="tabpanel" aria-labelledby={`${uid}-${section}`}>
      {section === "presets" && <>
        <div className="preset-platforms" aria-label="Площадки пресетов">
          {SCOPES.map(id => {
            const enabled = BAN_PRESETS.filter(p => (p.platform ?? "all") === id && isPresetApplied(p, f)).length;
            return <button key={id} type="button" aria-pressed={scope === id} onClick={() => setScope(id)}>
              {id === "all" ? <Globe2 size={14} /> : <PlatformIcon id={id} size={14} color={PLATFORMS[id].color} />}
              {SCOPE_NAMES[id]}{enabled > 0 && <span className="text-[10px] tabular-nums" style={{ color: "var(--dw-accent)" }}>{enabled}</span>}
            </button>;
          })}
        </div>
        <div className="mb-1 mt-5 flex items-center justify-between gap-3">
          <div><h3 className="text-[13px] font-semibold">{scope === "all" ? "Общая защита" : `Защита ${SCOPE_NAMES[scope]}`}</h3>
            <p className="mt-1 text-[11px]" style={{ color: "var(--dw-dim)" }}>{scope === "all" ? "Эти наборы действуют на всех площадках." : `Только для сообщений ${SCOPE_NAMES[scope]}. На другие площадки не влияет.`}</p>
          </div>
          <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: "var(--dw-dim)" }}>{scopeCount} из {presets.length} включено</span>
        </div>
        <div>{presets.map(p => <PresetRow key={p.id} preset={p} active={isPresetApplied(p, f)} onToggle={() => {
          const active = isPresetApplied(p, f);
          onChange({ filters: active ? unapplyPreset(f, p) : applyPreset(f, p) });
          toast(`«${p.label}» ${active ? "выключен" : "включён"}`);
        }} />)}</div>
        <p className="mt-4 text-[10.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>Наборы включаются независимо. Свои слова и авторы не удаляются при выключении пресета.</p>
        {f.legacyPresetLists && <p className="mt-2 text-[10.5px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>
          Списки из предыдущей версии сохранены как личные правила. <button type="button" onClick={() => setSection("words")} className="underline underline-offset-2">Посмотреть свои слова</button>
        </p>}
      </>}
      {section === "words" && <div className="space-y-5">
        <Panel title="Не озвучивать сообщение" desc="Свои слова или части слов. Применяются на всех площадках; правила пресетов хранятся отдельно.">
          <TagInput items={f.banWords} onChange={v => set({ banWords: v })} placeholder="Добавить слова через запятую" />
        </Panel>
        <Panel title="Заменять слово на «пип»" desc="Остальной текст сообщения будет озвучен.">
          <TagInput items={f.maskWords} onChange={v => set({ maskWords: v })} placeholder="Добавить слова для замены" accent="#d2a041" />
        </Panel>
      </div>}
      {section === "authors" && <div className="space-y-5">
        <Panel title="Игнорировать авторов" desc="Личный список ботов и пользователей. Действует на всех площадках.">
          <TagInput items={f.banAuthors} onChange={v => set({ banAuthors: v })} placeholder="Добавить имя в игнор-лист" />
        </Panel>
        <Panel title="Озвучивать только этих авторов" desc="Пустой список разрешает всех. Игнор-лист имеет приоритет.">
          <TagInput items={f.allowAuthors} onChange={v => set({ allowAuthors: v })} placeholder="Добавить разрешённого автора" accent="#2bb482" />
        </Panel>
      </div>}
      {section === "processing" && <div className="space-y-5">
        <Panel title="Обработка текста">
          <Toggle label="Заменять ссылки словом «ссылка»" on={f.links} onChange={links => set({ links })} />
          <Toggle label="Пропускать команды ! и /" on={f.commands} onChange={commands => set({ commands })} />
          <Toggle label="Не читать эмодзи и смайлы" on={f.emoji} onChange={emoji => set({ emoji, emojiTouched: true })} />
          <Toggle label="Не повторять сообщение автора 45 секунд" on={f.dedupe} onChange={dedupe => set({ dedupe })} />
          <Toggle label="Сокращать повторяющиеся символы" on={f.squashRepeats} onChange={squashRepeats => set({ squashRepeats })} />
          <Toggle label="Убирать специальные символы" on={f.stripSymbols} onChange={stripSymbols => set({ stripSymbols })} />
        </Panel>
        <Panel title="Ограничения" collapsible>
          <SettingRow label="Минимальная длина"><Slider label="Минимальная длина" value={f.minLen} min={1} max={20} onChange={minLen => set({ minLen })} format={v => `${v} симв.`} /></SettingRow>
          <SettingRow label="Максимальная длина"><Slider label="Максимальная длина" value={f.maxLen} min={20} max={1000} step={10} onChange={maxLen => set({ maxLen })} format={v => `${v} симв.`} /></SettingRow>
          <SettingRow label="Сообщений в минуту"><Slider label="Сообщений в минуту" value={f.perMin} min={1} max={120} onChange={perMin => set({ perMin })} /></SettingRow>
          <SettingRow label="Порог заглавных букв" hint="Выше порога текст переводится в нижний регистр."><Slider label="Порог заглавных букв" value={f.maxCapsRatio} min={0} max={100} onChange={maxCapsRatio => set({ maxCapsRatio })} format={v => `${v}%`} /></SettingRow>
        </Panel>
      </div>}
      {section === "test" && <Panel title="Проверить сообщение" desc="Проверка учитывает выбранную площадку, активные пресеты и личные правила.">
        <SettingRow label="Площадка"><Select label="Площадка проверки" value={testPlatform} onChange={setTestPlatform} options={PLATFORM_IDS.map(id => ({ id, label: SCOPE_NAMES[id] }))} /></SettingRow>
        <SettingRow label="Автор"><input aria-label="Автор для проверки" className="dw-select w-full" value={testAuthor} onChange={e => setTestAuthor(e.target.value)} /></SettingRow>
        <label className="mb-2 mt-3 block text-[12px]" htmlFor={`${uid}-message`}>Сообщение</label>
        <textarea id={`${uid}-message`} className="dw-select min-h-20 w-full resize-y" value={testText} onChange={e => setTestText(e.target.value)} />
        <div className="mt-3 flex items-center gap-3"><Btn variant="primary" onClick={runTest} disabled={!testText.trim()}><FlaskConical size={13} />Проверить</Btn>
          <span className="text-[10.5px]" style={{ color: "var(--dw-dim)" }}>Без воспроизведения звука</span>
        </div>
        {result && <div role="status" className="mt-4 rounded-md border px-3 py-2 text-[12px] leading-relaxed"
          style={{ borderColor: result.ok ? "rgba(34,155,115,.3)" : "rgba(231,95,104,.3)", color: "var(--dw-text)", background: result.ok ? "rgba(34,155,115,.07)" : "rgba(231,95,104,.07)" }}>
          <span className="font-semibold">{result.ok ? "Будет озвучено: " : "Не будет озвучено. "}</span>{result.ok ? `«${result.text}»` : "Сработал фильтр."}
        </div>}
      </Panel>}
    </div>
  </div>;
}
