import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Logo } from "./bits";
import { GithubIcon } from "./brands";
import { APP_TAG } from "../version";

const LINKS = [
  { href: "#demo", label: "Демо" },
  { href: "#features", label: "Возможности" },
  { href: "#widget", label: "OBS" },
  { href: "#game", label: "Оверлей" },
  { href: "#hotkeys", label: "Клавиши" },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="fixed inset-x-0 top-4 z-50 px-4">
      {/* парящая навигация-пилюля */}
      <div
        className={`mx-auto flex w-full max-w-3xl items-center gap-1.5 rounded-full border p-1.5 pl-4 backdrop-blur-2xl transition-all duration-500 ${
          scrolled
            ? "border-white/15 bg-void/80 shadow-[0_12px_48px_rgba(0,0,0,0.55)]"
            : "border-white/10 bg-void/40"
        }`}
      >
        <Logo size={13} />

        <nav className="ml-3 hidden items-center gap-0.5 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-full px-3.5 py-1.5 text-[12px] text-white/50 transition-all hover:bg-white/[0.07] hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href="https://github.com/yawaside/Yawachat.test"
            target="_blank"
            rel="noreferrer"
            className="grid h-8 w-8 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white"
            title="GitHub"
          >
            <GithubIcon size={14} />
          </a>
          <a
            href="#download"
            className="hidden items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-void transition-all hover:shadow-[0_0_28px_rgba(255,255,255,0.25)] sm:inline-flex"
          >
            {APP_TAG} <ArrowUpRight size={13} />
          </a>
          <button
            onClick={() => setOpen((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/[0.07] md:hidden"
            title="Меню"
          >
            {open ? <X size={15} /> : <Menu size={15} />}
          </button>
        </div>
      </div>

      {/* мобильное меню */}
      {open && (
        <div className="mx-auto mt-2 w-full max-w-3xl rounded-3xl border border-white/10 bg-void/95 p-3 backdrop-blur-2xl md:hidden">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-2xl px-4 py-3 text-[14px] text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </a>
          ))}
          <a
            href="#download"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-[14px] font-bold text-void"
          >
            Скачать {APP_TAG} <ArrowUpRight size={15} />
          </a>
        </div>
      )}
    </header>
  );
}
