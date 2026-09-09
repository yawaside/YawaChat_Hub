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

  /* Возврат с площадки авторизации (Twitch: #access_token=…, VK ID: ?code=…&state=…):
     показываем страницу-мост, которая передаёт токен/код в приложение. */
  const urlParams = typeof window !== "undefined" ? (window.location.hash || "") + (window.location.search || "") : "";
  const isOAuthReturn =
    typeof window !== "undefined" &&
    /(access_token=|code=|device_id=|state=)/.test(urlParams) &&
    !window.location.hash.startsWith("#/app") &&
    !window.location.hash.startsWith("#/overlay");
  if (isOAuthReturn) {
    return <OAuthCallback hash={window.location.hash} />;
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
