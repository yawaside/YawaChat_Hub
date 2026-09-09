import { useCallback, useEffect, useState } from "react";
import { Bot, Command, ExternalLink, FlaskConical, LogOut, Plus, Send, Trash2, Zap } from "lucide-react";
import { Btn, Label, Panel, Segmented, Select } from "./ui";
import { getSp, useBotAuth } from "../../lib/bridge";
import type { BotCommand, BotPlatform } from "../../lib/bridge";
import { PLATFORMS } from "../../lib/core";
import { PlatformBadge } from "../bits";

/**
 * Настройки чат-бота.
 *
 * Подключение аккаунтов находится здесь, а не рядом с каналами: пользователь
 * скачивает приложение и нажимает «Авторизоваться»: открывается браузер по
 * умолчанию со страницей входа Twitch/VK, после разрешения фокус возвращается
 * в приложение и канал подтягивается автоматически (токен не показывается).
 */
export default function ChatBotPanel({ toast }: { toast: (t: string) => void }) {
  const sp = getSp();
  const { state: auth, busy: authBusy, authorize, revoke } = useBotAuth(toast);
  const [platform, setPlatform] = useState<BotPlatform>("twitch");
  const [list, setList] = useState<BotCommand[]>([]);
  const [trigger, setTrigger] = useState("");
  const [response, setResponse] = useState("");
  const [cooldown, setCooldown] = useState(5);
  const [busy, setBusy] = useState(false);
  const [testText, setTestText] = useState("");
  const [testOut, setTestOut] = useState("");

  const reload = useCallback(() => {
    if (!sp?.bot) return;
    sp.bot.commands(platform).then((items) => setList(Array.isArray(items) ? items : [])).catch(() => setList([]));
  }, [sp, platform]);

  useEffect(() => { reload(); }, [reload]);

  /** Локальная проверка: что ответит бот на введённую фразу. */
  const runTest = useCallback(() => {
    const body = testText.trim();
    if (!body.startsWith("!")) { setTestOut("Введите команду, начиная с !"); return; }
    const trigger0 = body.split(/\s+/)[0].toLowerCase();
    const args = body.split(/\s+/).slice(1);
    const cmd = list.find((item) => item.trigger.toLowerCase() === trigger0);
    if (!cmd) { setTestOut(`Команда ${trigger0} не найдена`); return; }
    if (cmd.cooldownSec > 0 && cmd.lastRun && Date.now() - cmd.lastRun < cmd.cooldownSec * 1000) {
      setTestOut(`Кулдаун ${cmd.cooldownSec}с — ответ скрыт`);
      return;
    }
    setTestOut(cmd.response
      .replace(/{author}/gi, "тестовый_зритель")
      .replace(/{channel}/gi, "ваш_канал")
      .replace(/{args}/gi, args.join(" ") || "—"));
  }, [testText, list]);

  const add = async () => {
    if (!sp?.bot) { toast("Команды доступны в desktop-сборке"); return; }
    setBusy(true);
    try {
      const added = await sp.bot.addCommand(platform, { trigger, response, cooldownSec: cooldown });
      if ((added as BotCommand & { error?: string }).error) throw new Error((added as BotCommand & { error?: string }).error);
      setTrigger(""); setResponse(""); setCooldown(5);
      toast(`Команда добавлена (${PLATFORMS[platform].label})`);
      reload();
    } catch (error) {
      toast(String((error as Error)?.message || "Не удалось добавить команду"));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    sp?.bot?.removeCommand(platform, id);
    window.setTimeout(reload, 0);
  };

  const ConnectionCard = ({ id }: { id: BotPlatform }) => {
    const meta = PLATFORMS[id];
    const item = auth.find((entry) => entry.platform === id);
    const connected = Boolean(item?.authorized);
    const pending = authBusy === id;
    return (
      <div className="rounded-2xl border p-3.5" style={{ borderColor: connected ? `${meta.color}55` : "var(--dw-line)", background: connected ? `color-mix(in srgb, ${meta.color} 7%, var(--dw-panel2))` : "var(--dw-panel2)" }}>
        <div className="flex items-start gap-3">
          <PlatformBadge id={id} size={38} iconSize={23} radius={10} glow={connected} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold">{meta.label}</h3>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-wide" style={{ background: connected ? "rgba(74,222,128,.12)" : "var(--dw-input)", color: connected ? "#4ade80" : "var(--dw-dim)" }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: connected ? "#4ade80" : "var(--dw-dim)", boxShadow: connected ? "0 0 7px rgba(74,222,128,.7)" : "none" }} />
                {connected ? "подключен" : "не авторизован"}
              </span>
            </div>
            <p className="mt-1 text-[10.5px] leading-snug" style={{ color: "var(--dw-dim)" }}>
              {connected
                ? `${item?.account || meta.label}${item?.channel ? ` · канал ${item.channel}` : ""}`
                 : "Откроется браузер по умолчанию; после входа фокус вернётся в приложение, канал определится сам."}
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {connected ? (
            <Btn variant="outline" onClick={() => revoke(id)} className="h-8 flex-1"><LogOut size={12} /> Отключить</Btn>
          ) : (
            <Btn variant="primary" disabled={pending || !sp?.oauth} onClick={() => authorize(id)} className="h-8 flex-1"><ExternalLink size={12} /> {pending ? "Вход…" : "Авторизоваться"}</Btn>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="settings-page grid min-w-0 gap-5 xl:grid-cols-2" data-settings-page="bot">
      <div className="min-w-0 space-y-4">
        <Panel title="Подключения" desc="Авторизуйте аккаунты площадок. После входа бот сам подключит ваш канал, чтение чата, события стрима и модерацию.">
          <div className="grid gap-2 sm:grid-cols-2">
            <ConnectionCard id="twitch" />
            <ConnectionCard id="vk" />
          </div>
          {!sp?.oauth && (
            <p className="mt-3 rounded-xl border border-dashed px-3 py-2.5 text-[10.5px] leading-relaxed" style={{ borderColor: "var(--dw-line)", color: "var(--dw-dim)" }}>
              Авторизация работает в скачанном приложении. В браузерном демо доступен только интерфейс.
            </p>
          )}
        </Panel>

        <Panel title="Площадка команд" desc="Команды хранятся отдельно для Twitch и VK: в чате каждой площадки работает свой набор.">
          <Segmented
            value={platform}
            onChange={setPlatform}
            options={(["twitch", "vk"] as BotPlatform[]).map((id) => ({ id, label: PLATFORMS[id].label }))}
          />
        </Panel>

        <Panel title="Новая команда" desc="Команда → результат. Плейсхолдеры: {author}, {channel}, {args}, {login}.">
          <div className="space-y-3">
            <div>
              <Label hint="например !вк или !соцсети">Команда</Label>
              <input value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="!вк"
                className="h-9 w-full rounded-lg border bg-transparent px-3 font-mono text-[12px] outline-none placeholder:text-[var(--dw-dim)] focus:border-[var(--dw-accent)]" style={{ borderColor: "var(--dw-line)" }} />
            </div>
            <div>
              <Label hint="текст или ссылка">Результат</Label>
              <textarea value={response} onChange={(event) => setResponse(event.target.value)} rows={3} placeholder="Мы во ВКонтакте: https://vk.com/yawachat"
                className="min-h-[68px] w-full rounded-lg border bg-transparent px-3 py-2 text-[12px] outline-none placeholder:text-[var(--dw-dim)] focus:border-[var(--dw-accent)]" style={{ borderColor: "var(--dw-line)" }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Кулдаун</Label>
                <Select<string> value={String(cooldown)} onChange={(value) => setCooldown(Number(value))} options={[
                  { id: "0", label: "без кулдауна" }, { id: "3", label: "3 сек" }, { id: "5", label: "5 сек" }, { id: "10", label: "10 сек" },
                  { id: "30", label: "30 сек" }, { id: "60", label: "1 мин" }, { id: "300", label: "5 мин" },
                ]} />
              </div>
              <div className="flex items-end"><Btn variant="primary" onClick={add} disabled={busy || !trigger.trim() || !response.trim()} className="h-9 w-full"><Plus size={12} /> Добавить</Btn></div>
            </div>
          </div>
        </Panel>

        <Panel title="Проверка" desc="Прогон команды по текущим правилам — без отправки в чат." right={<FlaskConical size={14} style={{ color: "var(--dw-accent-2)" }} />} collapsible>
          <div className="space-y-3">
            <div>
              <Label>Сообщение из чата</Label>
              <input value={testText} onChange={(event) => setTestText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runTest(); }} placeholder="!вк"
                className="h-9 w-full rounded-lg border bg-transparent px-3 font-mono text-[12px] outline-none placeholder:text-[var(--dw-dim)] focus:border-[var(--dw-accent)]" style={{ borderColor: "var(--dw-line)" }} />
            </div>
            <Btn variant="outline" onClick={runTest} disabled={!testText.trim()}><Send size={12} /> Проверить</Btn>
            {testOut && <div className="rounded-xl border p-3 text-[11.5px] leading-relaxed" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>{testOut}</div>}
          </div>
        </Panel>
      </div>

      <Panel title={`Команды (${list.length})`} desc="Бот отвечает в чате той площадки, для которой создана команда." right={<Command size={14} style={{ color: "var(--dw-accent-2)" }} />}>
        {list.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: "var(--dw-line)" }}>
            <Bot size={22} className="mx-auto" style={{ color: "var(--dw-dim)" }} />
            <p className="mt-2 text-[11.5px]" style={{ color: "var(--dw-dim)" }}>Команд нет. Добавьте первую слева — например <code>!вк</code> со ссылкой на сообщество.</p>
          </div>
        ) : (
          <div className="scroll-thin max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {list.map((cmd) => (
              <div key={cmd.id} className="rounded-xl border p-3" style={{ borderColor: "var(--dw-line)", background: "var(--dw-bg)" }}>
                <div className="flex items-center gap-2">
                  <code className="rounded-md px-2 py-0.5 font-mono text-[11.5px] font-semibold" style={{ background: "var(--dw-input)", color: "var(--dw-accent-2)" }}>{cmd.trigger}</code>
                  <span className="inline-flex items-center gap-1 text-[10.5px]" style={{ color: "var(--dw-dim)" }}><Zap size={10} />{cmd.cooldownSec > 0 ? `кулдаун ${cmd.cooldownSec}с` : "без кулдауна"}</span>
                  <button type="button" onClick={() => remove(cmd.id)} title="Удалить команду" className="ml-auto grid h-6 w-6 place-items-center rounded-md hover:bg-[rgba(248,113,113,.15)] hover:text-red-400" style={{ color: "var(--dw-dim)" }}><Trash2 size={12} /></button>
                </div>
                <p className="mt-1.5 break-words text-[11.5px] leading-relaxed" style={{ color: "var(--dw-text)" }}>{cmd.response}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
