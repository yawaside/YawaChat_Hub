import { Eye, Gamepad2, Lock, MousePointerClick, Move } from "lucide-react";
import { PlatformIcon, Reveal, Section } from "./bits";
import { PLATFORMS } from "../lib/core";
import type { PlatformId } from "../lib/core";
import { fmtViewers } from "../lib/viewers";

const POINTS = [
  { icon: Move, title: "Перетаскивание", text: "Потяните окно в удобный угол — позиция запоминается." },
  { icon: Eye, title: "Онлайн площадок", text: "Иконки и зрители внизу ленты. Отключается одной настройкой." },
  { icon: MousePointerClick, title: "Сквозные клики", text: "Опция «клики насквозь» — игра получает ввод." },
  { icon: Lock, title: "Фиксация", text: "Заблокируйте оверлей, чтобы не сдвинуть во время матча." },
];

const DEMO_ONLINE: Array<{ id: PlatformId; viewers: number }> = [
  { id: "twitch", viewers: 1284 },
  { id: "kick", viewers: 342 },
  { id: "tiktok", viewers: 2610 },
];

export default function GameModeSection() {
  return (
    <Section
      id="game"
      kicker="game mode"
      title="Оверлей поверх игры — чат, не выходя из матча"
      desc="Отдельное окно всегда поверх игры: прозрачная подложка, горячая клавиша, один код с основным приложением."
    >
      <Reveal delay={0.05}>
        <div className="relative mt-12 overflow-hidden rounded-3xl border border-white/10">
          <img
            src="/game.jpg"
            alt="Игровой оверлей YawaChatHub поверх игры"
            className="h-[440px] w-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-void/90 via-transparent to-void/20" />

          {/* оверлей поверх «игры» */}
          <div className="absolute right-5 top-5 w-[250px] overflow-hidden rounded-2xl border border-white/15 bg-black/55 backdrop-blur-md">
            <div className="space-y-2 p-3.5">
              {[
                { id: "twitch", a: "neon_wolf", t: "ЛЕЕЕЕТС ГОООУ", c: "#a78bfa" },
                { id: "kick", a: "vanya_fps", t: "модератор молодец", c: "#4ade80" },
                { id: "tiktok", a: "luna228", t: "пошёл за чаем", c: "#f472b6" },
              ].map((m, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center" style={{ color: m.c }}>
                    <PlatformIcon id={m.id as PlatformId} size={11} />
                  </span>
                  <p className="text-[11px] leading-snug">
                    <span className="mr-1 font-bold" style={{ color: m.c }}>
                      {m.a}
                      <span className="opacity-50">:</span>
                    </span>
                    <span className="text-white/85">{m.t}</span>
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3.5 border-t border-white/10 px-3.5 py-2">
              {DEMO_ONLINE.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5">
                  <span
                    className="grid h-4 w-4 place-items-center rounded-[5px] text-white"
                    style={{ background: PLATFORMS[p.id].color }}
                  >
                    <PlatformIcon id={p.id} size={9} />
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-white/80">
                    {fmtViewers(p.viewers)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="absolute bottom-5 left-5 flex items-center gap-2.5 rounded-full border border-white/15 bg-black/50 py-2 pl-3.5 pr-4 backdrop-blur-md">
            <Gamepad2 size={13} className="text-viol" />
            <span className="font-mono text-[10.5px] text-white/70">Ctrl+Shift+G — показать / скрыть</span>
          </div>
        </div>
      </Reveal>

      <div className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.06} y={18}>
            <div className="border-t border-white/10 pt-5">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-viol">
                <p.icon size={16} />
              </span>
              <h3 className="mt-4 text-[14.5px] font-bold text-white/90">{p.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/35">{p.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
