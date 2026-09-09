import { useMemo } from "react";
import { ArrowRight, ListX, Pause, Play, SkipForward } from "lucide-react";
import type { SpeechEngine } from "../../lib/core";
import type { TtsConfig } from "../../lib/tts-config";
import { isDesktop } from "../../lib/bridge";
import { Btn, Panel, Select, SettingRow, Slider, Toggle } from "./ui";

/** Voice settings have one owner each. Word/author rules live only in FiltersPanel. */
export default function VoicePanel({ speech, cfg, onChange, toast, onOpenFilters }: {
  speech: SpeechEngine; cfg: TtsConfig; onChange: (patch: Partial<TtsConfig>) => void;
  toast: (t: string) => void; onOpenFilters?: () => void;
}) {
  const desktop = isDesktop();
  const voices = useMemo(() => speech.voices.filter(v => !desktop || !v.localService ||
    /^ru/i.test(v.lang || "") || /ru|рус|russian|ирина|павел|silero/i.test(v.name))
    .slice().sort((a, b) => {
      const ru = (v: SpeechSynthesisVoice) => /^ru/i.test(v.lang || "") ? 0 : 1;
      return ru(a) - ru(b) || a.name.localeCompare(b.name, "ru");
    }), [speech.voices, desktop]);
  const selectedVoice = cfg.voiceURI || speech.voiceURI || "";
  const template = cfg.template;
  const previewText = `${template.author || template.platform ? `${template.author ? "neon_wolf" : "Зритель"}${template.platform ? " с Твича" : ""} говорит: ` : ""}Привет из чата!`;
  const output = !cfg.obsTts ? "local" : cfg.alsoLocal ? "both" : "obs";
  const listen = async () => {
    const result = await speech.preview(selectedVoice, previewText);
    toast(result?.ok ? "Тестовая фраза воспроизводится" : result?.error || "Не удалось запустить озвучку");
  };
  return <div className="settings-page max-w-[760px] space-y-5" data-settings-page="voice">
    <Toggle label="Озвучивать сообщения" on={cfg.enabled} onChange={enabled => { onChange({ enabled }); speech.setEnabled(enabled); }} />
    <Panel title="Голос и звук">
      <SettingRow label="Голос" hint={desktop ? "Русские голоса Edge TTS и Windows SAPI." : "Доступные голоса браузера."}>
        <select aria-label="Голос озвучки" value={selectedVoice} onChange={e => onChange({ voiceURI: e.target.value })} className="dw-select w-full">
          <option value="">Автоматически</option>
          {selectedVoice && !voices.some(v => v.voiceURI === selectedVoice) && <option value={selectedVoice}>{selectedVoice}</option>}
          {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Скорость речи"><Slider label="Скорость речи" value={cfg.rate} min={.5} max={2} step={.1} onChange={rate => onChange({ rate })} format={v => `×${v.toFixed(1)}`} /></SettingRow>
      <SettingRow label="Громкость"><Slider label="Громкость озвучки" value={Math.round(cfg.volume * 100)} min={0} max={100} onChange={volume => onChange({ volume: volume / 100 })} format={v => `${v}%`} /></SettingRow>
      <SettingRow label="Куда выводить звук" hint={!desktop ? "Вывод в OBS доступен в desktop-сборке." : undefined}>
        <Select label="Вывод звука" value={output} options={[
          { id: "local", label: "Этот компьютер" }, { id: "obs", label: "Только виджет OBS" }, { id: "both", label: "Этот компьютер и OBS" },
        ]} onChange={v => onChange(v === "local" ? { obsTts: false } : { obsTts: true, alsoLocal: v === "both" })} />
      </SettingRow>
    </Panel>
    <Panel title="Состав фразы">
      <Toggle label="Читать имя автора" on={template.author} onChange={author => onChange({ template: { ...template, author } })} />
      <Toggle label="Называть площадку" on={template.platform} onChange={platform => onChange({ template: { ...template, platform } })} />
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md px-3 py-2.5" style={{ background: "var(--dw-input)" }}>
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed" data-speech-example>{previewText}</p>
        <Btn variant="outline" disabled={!speech.supported || !selectedVoice} onClick={listen}><Play size={12} />Прослушать пример</Btn>
      </div>
    </Panel>
    <Panel title="Очередь озвучки" collapsible>
      <p className="mb-2 text-[11px]" style={{ color: "var(--dw-dim)" }}>
        В очереди: {speech.queueSize} · пропущено: {speech.skipped}
      </p>
      <p className="mb-3 truncate text-[12px]">{speech.now?.label || (cfg.enabled ? "Ожидаем сообщения" : "Озвучка выключена")}</p>
      <div className="flex flex-wrap gap-2">
        <Btn disabled={!cfg.enabled} onClick={() => speech.setPaused(!speech.paused)}>{speech.paused ? <Play size={12} /> : <Pause size={12} />}{speech.paused ? "Продолжить" : "Пауза"}</Btn>
        <Btn disabled={!cfg.enabled} onClick={speech.skip}><SkipForward size={12} />Пропустить</Btn>
        <Btn variant="outline" disabled={!speech.queueSize} onClick={() => { speech.clearQueue(); toast("Очередь очищена"); }}><ListX size={12} />Очистить очередь</Btn>
      </div>
    </Panel>
    {onOpenFilters && <button type="button" onClick={onOpenFilters} className="inline-flex items-center gap-2 text-[11.5px] hover:underline" style={{ color: "var(--dw-accent)" }}>
      Пресеты, слова и правила обработки<ArrowRight size={13} />
    </button>}
  </div>;
}
