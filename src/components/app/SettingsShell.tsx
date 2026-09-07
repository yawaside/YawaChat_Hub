import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Ban, Gamepad2, Info, Keyboard, LayoutList, Menu, Palette, Search,
  SlidersHorizontal, Volume2, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AutoSave } from "./ui";

export type SettingsTabId =
  | "voice" | "filters" | "chatview" | "widget" | "overlay" | "hotkeys" | "interface" | "about";

interface TabMeta {
  id: SettingsTabId;
  label: string;
  short: string;
  desc: string;
  icon: LucideIcon;
  /** ключевые слова для поиска по настройкам */
  keys: string[];
}

export const SETTINGS_TABS: TabMeta[] = [
  {
    id: "voice", label: "Озвучка", short: "Озвучка",
    desc: "Голос, скорость, громкость и шаблон сообщения",
    icon: Volume2, keys: ["голос", "tts", "скорость", "громкость", "шаблон", "очередь", "sapi", "звук"],
  },
  {
    id: "filters", label: "Фильтры озвучки", short: "Фильтры",
    desc: "Что не озвучивать: мат, скам, спам, стоп-слова, авторы",
    icon: Ban, keys: ["мат", "банворд", "скам", "спам", "18+", "пип", "стоп-слова", "игнор", "боты", "чёрный список", "белый список", "команды", "эмодзи", "смайлы", "повторы", "пресеты", "лимит", "площадки"],
  },
  {
    id: "chatview", label: "Вид ленты", short: "Лента",
    desc: "Интервалы, отступы, размер текста и анимация",
    icon: LayoutList, keys: ["лента", "отступ", "плотность", "размер текста", "интервал", "скругление", "подложка", "эффект", "анимация", "compact"],
  },
  {
    id: "widget", label: "Виджет OBS", short: "OBS",
    desc: "Тема виджета, ссылка с токеном и подключение в OBS",
    icon: SlidersHorizontal, keys: ["obs", "виджет", "browser source", "токен", "ссылка", "url", "тема", "прозрачность"],
  },
  {
    id: "overlay", label: "Оверлей", short: "Оверлей",
    desc: "Окно поверх игры: позиция, клики насквозь, TTL",
    icon: Gamepad2, keys: ["оверлей", "игра", "поверх окон", "клики", "перетаскивание", "фиксация", "ttl", "время жизни"],
  },
  {
    id: "hotkeys", label: "Горячие клавиши", short: "Клавиши",
    desc: "Глобальные сочетания — работают даже из трея",
    icon: Keyboard, keys: ["клавиши", "хоткеи", "сочетания", "ctrl", "shift", "горячие", "ярлыки"],
  },
  {
    id: "interface", label: "Интерфейс", short: "Интерфейс",
    desc: "Вариант оформления и поведение окна",
    icon: Palette, keys: ["интерфейс", "вариант", "тема", "оформление", "трей", "окно", "сворачивать", "запуск"],
  },
  {
    id: "about", label: "О программе", short: "О программе",
    desc: "Версия, автор и ссылки",
    icon: Info, keys: ["о программе", "версия", "автор", "донат", "ссылки", "youtube", "twitch", "vk"],
  },
];

/** Группы навигации — вместо плоского списка из восьми пунктов. */
export const SETTINGS_GROUPS: Array<{ id: string; label: string; tabs: SettingsTabId[] }> = [
  { id: "sound", label: "Звук", tabs: ["voice", "filters"] },
  { id: "feed", label: "Лента", tabs: ["chatview"] },
  { id: "output", label: "Вывод", tabs: ["widget", "overlay"] },
  { id: "system", label: "Система", tabs: ["hotkeys", "interface", "about"] },
];

export function tabMeta(id: SettingsTabId): TabMeta {
  return SETTINGS_TABS.find((t) => t.id === id) ?? SETTINGS_TABS[0];
}

/**
 * Оболочка настроек: сгруппированная навигация + поиск + заголовок вкладки.
 * Содержимое вкладки передаётся через children.
 */
export default function SettingsShell({ active, onSelect, savedAt, onClose, collapsed, onToggleCollapsed, children }: {
  active: SettingsTabId; onSelect: (id: SettingsTabId) => void; savedAt: number; onClose: () => void;
  collapsed: boolean; onToggleCollapsed: () => void; children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const meta = tabMeta(active);
  const q = query.trim().toLowerCase();
  const found = useMemo(() => !q ? null : SETTINGS_TABS.filter(t =>
    [t.label, t.desc, ...t.keys].some(text => text.toLowerCase().includes(q))), [q]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [active]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  const navButton = (t: TabMeta) => {
    const Icon = t.icon;
    return <button key={t.id} type="button" title={t.label} aria-current={active === t.id ? "page" : undefined}
      onClick={() => { onSelect(t.id); setQuery(""); }} className="settings-nav-button"
      style={{ color: active === t.id ? "var(--dw-text)" : "var(--dw-dim)",
        background: active === t.id ? "var(--dw-input)" : "transparent",
        boxShadow: active === t.id ? "inset 2px 0 var(--dw-accent)" : "none" }}>
      <Icon size={15} className="shrink-0" /><span className={collapsed ? "sm:hidden" : ""}>{t.short}</span>
    </button>;
  };
  return <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Настройки"
    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none sm:flex-row"
    onKeyDown={e => {
      if (e.key === "Escape") { e.stopPropagation(); if (query) setQuery(""); else onClose(); }
      if (e.key === "Tab") {
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, a[href], [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first?.focus(); }
      }
    }}>
    <aside className="settings-navigation" data-collapsed={collapsed}
      style={{ borderColor: "var(--dw-line)", background: "var(--dw-panel)" }}>
      <div className="flex items-center gap-1.5 p-2">
        <label className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 ${collapsed ? "sm:hidden" : ""}`} style={{ background: "var(--dw-input)" }}>
          <Search size={13} className="shrink-0" style={{ color: "var(--dw-dim)" }} />
          <input aria-label="Поиск по настройкам" placeholder="Найти настройку" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && found?.[0]) { e.preventDefault(); onSelect(found[0].id); setQuery(""); } }}
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[var(--dw-dim)]" />
          {query && <button type="button" title="Очистить поиск" onClick={() => setQuery("")}><X size={11} /></button>}
        </label>
        <button type="button" onClick={onToggleCollapsed} title={collapsed ? "Развернуть меню" : "Свернуть меню"}
          className="hidden h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-[var(--dw-hover)] sm:grid" style={{ color: "var(--dw-dim)" }}>
          {collapsed ? <Search size={14} /> : <Menu size={14} />}
        </button>
      </div>
      <nav aria-label="Разделы настроек" className="settings-nav-list scroll-thin">
        {found ? <>
          {!found.length && <p className="p-2 text-[11px]" style={{ color: "var(--dw-dim)" }}>Ничего не найдено</p>}
          {found.map(navButton)}
        </> : SETTINGS_GROUPS.map(group => <div className="settings-nav-group" key={group.id}>
          {!collapsed && <div className="settings-nav-label" style={{ color: "var(--dw-dim)" }}>{group.label}</div>}
          {group.tabs.map(id => navButton(tabMeta(id)))}
        </div>)}
      </nav>
      {!collapsed && <p className="mt-auto hidden p-3 text-[10px] leading-relaxed sm:block" style={{ color: "var(--dw-dim)" }}>Изменения сохраняются сразу</p>}
    </aside>
    <div ref={content} className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-3"
        style={{ background: "var(--dw-panel)", borderColor: "var(--dw-line)" }}>
        <div className="min-w-0 flex-1"><h2 className="text-[14px] font-semibold">{meta.label}</h2>
          <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--dw-dim)" }}>{meta.desc}</p>
        </div>
        <AutoSave stamp={savedAt} />
        <button type="button" title="Закрыть настройки" onClick={onClose} className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-[var(--dw-hover)]" style={{ color: "var(--dw-dim)" }}><X size={15} /></button>
      </header>
      <div className="p-4">{children}</div>
    </div>
  </div>;
}
