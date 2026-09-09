import { BAN_PRESETS, DEFAULT_FILTERS, uniqueFilterEntries } from "./core";
import type { TTSTemplate, TTSFilters } from "./core";

export interface TtsConfig {
  enabled: boolean;
  rate: number;
  volume: number;
  voiceURI: string;
  obsTts: boolean;
  alsoLocal: boolean;
  template: TTSTemplate;
  filters: TTSFilters;
}

export const DEFAULT_TTS: TtsConfig = {
  enabled: false, rate: 1, volume: .9, voiceURI: "", obsTts: false, alsoLocal: true,
  template: { author: true, platform: true, text: true }, filters: DEFAULT_FILTERS,
};

export function sanitizeTts(raw: unknown): TtsConfig {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<TtsConfig>;
  const saved = src.filters ?? {} as Partial<TTSFilters>;
  const filters = { ...DEFAULT_FILTERS, ...saved };
  filters.banWords = uniqueFilterEntries(filters.banWords);
  filters.maskWords = uniqueFilterEntries(filters.maskWords);
  filters.banAuthors = uniqueFilterEntries(filters.banAuthors);
  filters.allowAuthors = uniqueFilterEntries(filters.allowAuthors);
  // Preserve all legacy merged words as custom rules: their ownership cannot be inferred safely.
  filters.legacyPresetLists = saved.legacyPresetLists === true ||
    (!Array.isArray(saved.enabledPresets) && !!(filters.banWords.length + filters.maskWords.length + filters.banAuthors.length));
  const ids = new Set(BAN_PRESETS.map(p => p.id));
  filters.enabledPresets = uniqueFilterEntries(saved.enabledPresets).filter(id => ids.has(id));
  if (!filters.emojiTouched) filters.emoji = DEFAULT_FILTERS.emoji;
  return {
    ...DEFAULT_TTS, ...src,
    template: { ...DEFAULT_TTS.template, ...(src.template ?? {}), text: true },
    filters,
  };
}
