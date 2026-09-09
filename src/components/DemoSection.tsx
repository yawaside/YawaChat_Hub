import { ExternalLink } from "lucide-react";
import DesktopApp from "./DesktopApp";
import { Reveal, Section } from "./bits";

export default function DemoSection() {
  return (
    <Section
      id="demo"
      kicker="live demo"
      title={
        <>
          Это не скриншот — это{" "}
          <span className="bg-gradient-to-r from-viol to-cy bg-clip-text text-transparent">
            живое окно приложения
          </span>
        </>
      }
      desc="Сайт и exe делят один код. Всё, что ниже, — настоящий интерфейс с демо-потоком: кликайте, подключайте каналы, меняйте настройки."
    >
      <Reveal delay={0.05}>
        <div className="relative mt-14">
          {/* подсветка */}
          <div className="absolute -inset-x-8 -top-10 -z-10 h-[240px] bg-gradient-to-r from-viol/15 via-cy/10 to-viol/15 blur-3xl" />

          <div className="overflow-hidden rounded-3xl border border-white/12 bg-[#0a0b13] shadow-[0_80px_180px_-60px_rgba(0,0,0,0.85)]">
            {/* минимальная шапка окна */}
            <div className="flex items-center gap-3 border-b border-white/[0.07] px-5 py-3.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/60" />
              </div>
              <span className="mx-auto hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-1 font-mono text-[10.5px] text-white/30 sm:block">
                yawachathub — единая лента
              </span>
              <a
                href="#/app"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] text-white/35 transition-colors hover:border-viol hover:text-viol"
                title="Открыть интерфейс в отдельной вкладке"
              >
                <ExternalLink size={10} /> развернуть
              </a>
            </div>

            {/* настоящий интерфейс приложения */}
            <div className="h-[700px]">
              <DesktopApp />
            </div>
          </div>

          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-[10.5px] text-white/35">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-viol" />
              3 варианта интерфейса — переключайте иконками в шапке окна или в «Настройки → Интерфейс»
            </span>
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
