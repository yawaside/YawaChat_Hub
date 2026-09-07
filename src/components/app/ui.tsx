import { ChevronDown, X } from "lucide-react";
import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../utils/cn";

/** Flat settings group. Actions are siblings of the accordion button, never nested buttons. */
export function Panel({ title, desc, right, children, className = "", collapsible = false, defaultOpen = false }: {
  title?: string; desc?: string; right?: ReactNode; children: ReactNode; className?: string;
  collapsible?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const shown = !collapsible || open;
  return (
    <section className={cn("min-w-0", className)} aria-label={title}>
      {(title || right) && <div className="mb-2 flex items-center gap-2 border-t pt-2" style={{ borderColor: "var(--dw-line)" }}>
        {collapsible ? <h3 className="min-w-0 flex-1">
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={shown} aria-controls={contentId}
            className="flex min-h-7 w-full items-center gap-1.5 rounded text-left text-[12px] font-semibold hover:bg-[var(--dw-hover)]">
            <ChevronDown size={13} className="shrink-0 transition-transform" style={{ color: "var(--dw-dim)", transform: shown ? "none" : "rotate(-90deg)" }} />
            {title}
          </button>
        </h3> : <h3 className="min-w-0 flex-1 text-[12px] font-semibold">{title}</h3>}
        {right && <div className="shrink-0">{right}</div>}
      </div>}
      {shown && <div id={contentId}>
        {desc && <p className="mb-3 text-[11px] leading-relaxed" style={{ color: "var(--dw-dim)" }}>{desc}</p>}
        {children}
      </div>}
    </section>
  );
}

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="setting-row">
    <div><span className="text-[12px] font-medium">{label}</span>
      {hint && <p className="mt-0.5 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>{hint}</p>}
    </div><div className="min-w-0">{children}</div>
  </div>;
}

export function Select<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; label?: string;
}) {
  return <div className="relative min-w-0">
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value as T)} className="dw-select w-full appearance-none pr-7">
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
    <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--dw-dim)" }} />
  </div>;
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div className="flex items-center gap-2">
    <input type="color" aria-label="Выбрать цвет" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={e => onChange(e.target.value)}
      className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-1" style={{ borderColor: "var(--dw-line)" }} />
    <input aria-label="Код цвета" value={value} onChange={e => onChange(e.target.value)}
      className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-[11px]" style={{ borderColor: "var(--dw-line)" }} />
  </div>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px]" style={{ color: "var(--dw-dim)" }}>
    <span>{children}</span>{hint && <span className="text-[10px]">{hint}</span>}
  </div>;
}

export function Slider({ value, min, max, step = 1, onChange, format, color = "var(--dw-accent)", label }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
  format?: (v: number) => string; color?: string; label?: string;
}) {
  const p = max === min ? 0 : Math.min(100, Math.max(0, (value - min) / (max - min) * 100));
  return <div className="flex min-w-0 items-center gap-3">
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))} className="min-w-0 flex-1"
      style={{ "--p": `${p}%`, "--range-fill": color } as CSSProperties} />
    <output className="min-w-12 shrink-0 text-right font-mono text-[10.5px] tabular-nums" style={{ color: "var(--dw-dim)" }}>{format ? format(value) : value}</output>
  </div>;
}

export function Toggle({ on, onChange, label, hint, accent = "var(--dw-accent)", disabled }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; accent?: string; disabled?: boolean;
}) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
    className="flex min-h-8 w-full items-center justify-between gap-3 rounded-md py-1.5 text-left transition-colors hover:bg-[var(--dw-hover)] disabled:cursor-not-allowed disabled:opacity-50">
    <span className="min-w-0"><span className="block text-[12px]">{label}</span>
      {hint && <span className="mt-0.5 block text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>{hint}</span>}
    </span>
    <span aria-hidden="true" className="relative h-[18px] w-8 shrink-0 rounded-full transition-colors" style={{ background: on ? accent : "var(--dw-scroll)" }}>
      <span className="absolute left-[3px] top-[3px] h-3 w-3 rounded-full bg-white transition-transform" style={{ transform: `translateX(${on ? 14 : 0}px)` }} />
    </span>
  </button>;
}

export function Btn({ children, onClick, variant = "ghost", disabled, className = "", title }: {
  children: ReactNode; onClick?: () => void; variant?: "ghost" | "primary" | "danger" | "outline";
  disabled?: boolean; className?: string; title?: string;
}) {
  const styles: Record<string, CSSProperties> = {
    primary: { background: "var(--dw-accent, #8b5cf6)", color: "#fff", border: "1px solid transparent" },
    danger: { background: "rgba(248,113,113,.08)", color: "#e75f68", border: "1px solid rgba(248,113,113,.2)" },
    outline: { border: "1px solid var(--dw-line)", color: "var(--dw-text)" },
    ghost: { background: "var(--dw-input)", color: "var(--dw-text)", border: "1px solid transparent" },
  };
  return <button type="button" title={title} disabled={disabled} onClick={onClick}
    className={cn("inline-flex min-h-7 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40", className)} style={styles[variant]}>{children}</button>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ id: T; label: ReactNode }>; onChange: (v: T) => void; label?: string;
}) {
  return <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-md border p-0.5" style={{ borderColor: "var(--dw-line)" }}>
    {options.map(o => <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
      className="flex min-h-7 items-center gap-1 rounded px-2.5 py-1 text-[11px] transition-colors"
      style={{ background: value === o.id ? "var(--dw-input)" : "transparent", color: value === o.id ? "var(--dw-text)" : "var(--dw-dim)", fontWeight: value === o.id ? 600 : 400 }}>
      {o.label}
    </button>)}
  </div>;
}

export function TagInput({ items, onChange, placeholder, accent = "#e75f68" }: {
  items: string[]; onChange: (v: string[]) => void; placeholder: string; accent?: string;
}) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  const add = () => {
    const parts = draft.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...new Set([...items.map(s => s.trim().toLowerCase()), ...parts])]);
    setDraft("");
  };
  const visible = expanded ? items : items.slice(0, 12);
  return <div>
    <div className="flex gap-2">
      <input value={draft} aria-label={placeholder} placeholder={placeholder} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2.5 text-[11.5px] placeholder:text-[var(--dw-dim)]" style={{ borderColor: "var(--dw-line)" }} />
      <Btn variant="outline" onClick={add} disabled={!draft.trim()}>Добавить</Btn>
    </div>
    {!!items.length && <>
      <div className="scroll-thin mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
        {visible.map((word, i) => <span key={`${word}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded px-2 py-1 text-[11px]"
          style={{ background: `color-mix(in srgb, ${accent} 9%, transparent)`, color: "var(--dw-text)" }}>
          <span className="break-all">{word}</span><button type="button" aria-label={`Удалить ${word}`} onClick={() => onChange(items.filter(w => w !== word))} className="shrink-0"><X size={11} /></button>
        </span>)}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10.5px]" style={{ color: "var(--dw-dim)" }}>
        {items.length > 12 && <button type="button" onClick={() => setExpanded(v => !v)}>{expanded ? "Свернуть список" : `Показать все (${items.length})`}</button>}
        <button type="button" onClick={() => onChange([])}>Очистить список</button>
      </div>
    </>}
  </div>;
}

export function NumberInput({ value, min, max, onChange, suffix }: {
  value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string;
}) {
  return <div className="flex items-center gap-2">
    <input type="number" value={value} min={min} max={max} onChange={e => {
      const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
    }} className="h-8 w-24 rounded-md border bg-transparent px-2.5 font-mono text-[11.5px]" style={{ borderColor: "var(--dw-line)" }} />
    {suffix && <span className="text-[10.5px]" style={{ color: "var(--dw-dim)" }}>{suffix}</span>}
  </div>;
}

export function AutoSave({ stamp }: { stamp: number }) {
  return stamp ? <span role="status" className="inline-flex items-center gap-1.5 text-[10.5px]" style={{ color: "var(--dw-accent)" }}>
    <span className="h-1 w-1 rounded-full bg-current" />Сохранено
  </span> : null;
}
