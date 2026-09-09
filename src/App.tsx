import { useSyncExternalStore } from "react";
import Nav from "./components/Nav";
import Hero from "./components/Hero";
import DemoSection from "./components/DemoSection";
import DesktopApp from "./components/DesktopApp";
import OverlayApp from "./components/OverlayApp";
import OAuthCallback from "./components/OAuthCallback";
import WidgetSection from "./components/WidgetSection";
import GameModeSection from "./components/GameModeSection";
import { DownloadSection, Features, Footer, Hotkeys } from "./components/sections";
import { getUiMode } from "./lib/bridge";
import type { UiMode } from "./lib/bridge";

const subscribeToMode = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
const serverMode = (): UiMode => "site";

export default function App() {
  const mode = useSyncExternalStore(subscribeToMode, getUiMode, serverMode);

  /* Возврат с площадки авторизации: в адресе есть access_token или ошибка.
     Показываем страницу-мост, которая передаёт токен в приложение. */
  const oauthReturn = (() => {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash || "";
    if (hash.startsWith("#/app") || hash.startsWith("#/overlay")) return null;
    return /access_token=|error=|error_description=/.test(hash) ? hash : null;
  })();
  if (oauthReturn) {
    return <OAuthCallback hash={oauthReturn} />;
  }

  /* Один код — три режима: сайт / окно приложения / игровой оверлей (Electron) */
  if (mode === "overlay") {
    return <OverlayApp />;
  }
  if (mode === "app") {
    return (
      <div className="h-screen overflow-hidden bg-void text-white">
        <DesktopApp />
      </div>
    );
  }
  return (
    <div className="relative min-h-screen bg-void text-white">
      <Nav />
      <main>
        <Hero />
        <DemoSection />
        <Features />
        <WidgetSection />
        <GameModeSection />
        <Hotkeys />
        <DownloadSection />
      </main>
      <Footer />
    </div>
  );
}
