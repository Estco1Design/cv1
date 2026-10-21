"use client";
import { useState, useEffect, useRef } from "react";
type Task = {
  id: string;
  prompt: string;
  status: string;
  source_handle: string;
  source_kind: string;
  counts: {
    discovered: number;
    qualified: number;
    prepared: number;
    rejected: number;
  };
};
export default function AgentChat() {
  const [state, setState] = useState<any>(null),
    [task, setTask] = useState<any>(null),
    [selected, setSelected] = useState(""),
    [prompt, setPrompt] = useState(""),
    [source, setSource] = useState("browser"),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"chat" | "results" | "tools">("chat");
  const current = useRef("");
  async function load() {
    try {
      const r = await fetch("/api/agent/state");
      const s = await r.json();
      if (!r.ok) throw new Error(s.error);
      setState(s);
      if (current.current) {
        const id = current.current;
        const detail = await fetch("/api/agent/tasks/" + id);
        const d = await detail.json();
        if (detail.ok && current.current === id) setTask(d);
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  useEffect(() => {
    const saved = localStorage.getItem("hideki-agent-task");
    if (saved) {
      current.current = saved;
      setSelected(saved);
    }
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, []);
  function choose(id: string) {
    current.current = id;
    setSelected(id);
    setTask(null);
    localStorage.setItem("hideki-agent-task", id);
    load();
  }
  async function action(path: string, body: any) {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.id) {
        choose(d.id);
        setTab("chat");
      }
      await load();
      return d;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    const d = await action(
      selected ? "agent/tasks/" + selected + "/chat" : "agent/tasks",
      selected ? { text: prompt } : { prompt, source },
    );
    if (d) setPrompt("");
  }
  const conn = state?.connections;
  const tasks: Task[] = state?.tasks || [];
  const candidates = task?.candidates || [];
  const ready = candidates.filter((c: any) => c.stage === "done");
  return (
    <div className="agent-shell">
      <aside className="agent-sidebar">
        <a className="brand" href="/">
          HIDEKI<span>AI OPERATOR / V2</span>
        </a>
        <button
          className="agent-new"
          onClick={() => {
            current.current = "";
            setSelected("");
            setTask(null);
            setPrompt("");
            localStorage.removeItem("hideki-agent-task");
          }}
        >
          + НОВАЯ ЗАДАЧА
        </button>
        <div className="agent-tasklist">
          {tasks.length ? (
            tasks.map((t) => (
              <button
                key={t.id}
                className={selected === t.id ? "chosen" : ""}
                onClick={() => choose(t.id)}
              >
                <span>@{t.source_handle || "Новая задача"}</span>
                <small>
                  {t.status} · {t.counts.prepared} офферов
                </small>
                <p>{t.prompt}</p>
              </button>
            ))
          ) : (
            <p className="muted">
              Здесь появится память задач. Она сохраняется после перезапуска.
            </p>
          )}
        </div>
        <a className="agent-crmlink" href="/crm">
          CRM / Лиды, офферы, настройки ↗
        </a>
      </aside>
      <main className="agent-main">
        <header>
          <span>HIDEKI / AGENT CHAT</span>
          <a href="/crm">ОТКРЫТЬ CRM ↗</a>
        </header>
        <div className="agent-connections">
          <span>
            WORKER:{" "}
            {Date.now() - (conn?.workerHeartbeat || 0) < 180000
              ? "ЕСТЬ HEARTBEAT"
              : "НЕТ HEARTBEAT"}
          </span>
          <span className={conn?.httpConfigured ? "available" : ""}>
            HTTP: {conn?.httpConfigured ? "АДРЕС НАСТРОЕН" : "НЕ ПОДКЛЮЧЁН"}
          </span>
          <span className={conn?.browserSessionPresent ? "available" : ""}>
            BROWSER:{" "}
            {conn?.browserSessionPresent ? "СЕССИЯ СОХРАНЕНА" : "НУЖЕН ВХОД"}
          </span>
          <span>AI: {conn?.aiBaseUrl || "Проверяем настройки…"}</span>
        </div>
        <p className="agent-honesty">
          Сохранённая конфигурация не подтверждает доступ. Вход, данные и AI
          проверяются реальными вызовами инструментов.
        </p>
        {notice && (
          <div role="status" className="notice">
            {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {!selected ? (
          <section className="agent-welcome">
            <span className="eyebrow">НЕ ПРОСТО CRM. ВАШ AI ОПЕРАТОР.</span>
            <h1>
              Поставьте задачу.
              <br />
              <em>Агент займётся поиском.</em>
            </h1>
            <p>
              От подписчиков конкретного аккаунта — к проверенным клиентам и
              персональным предложениям. Каждый вывод связан с источником,
              каждый шаг сохраняется.
            </p>
            <button
              className="agent-example"
              onClick={() =>
                setPrompt(
                  "Проанализируй подписчиков @alexandro_hideki, найди 30 потенциальных клиентов из Москвы для fashion-съёмок Александра Хидеки, изучи последние публикации, подготовь по три персональных оффера, выбери лучшие и подготовь отправку в Direct.",
                )
              }
            >
              ↗ Подписчики @alexandro_hideki → Москва → 30 клиентов
            </button>
            <details className="agent-login">
              <summary>Как подключить Instagram на Mac</summary>
              <ol>
                <li>
                  Установите зависимости и браузер: <code>npm ci</code>,{" "}
                  <code>npx playwright install chromium</code>.
                </li>
                <li>
                  Остановите worker. Выполните{" "}
                  <code>npm run instagram:login</code>.
                </li>
                <li>
                  Войдите в отдельном окне Instagram самостоятельно, включая
                  2FA, затем нажмите Enter в терминале.
                </li>
                <li>
                  Закройте окно входа, запустите <code>npm run worker</code>.
                  Сессия остаётся только на сервере/вашем Mac.
                </li>
              </ol>
              <p>
                Не передавайте пароль или cookie в чат. Если Instagram не
                показывает подписчиков, агент остановится; обхода ограничений
                нет.
              </p>
            </details>
          </section>
        ) : task ? (
          <>
            <section className="agent-taskheader">
              <div>
                <span className="eyebrow">TASK / {task.id.slice(0, 8)}</span>
                <h1>@{task.source_handle || "Разбор задачи"}</h1>
                <p>
                  {task.intent
                    ? `${task.intent.city} · цель ${task.intent.targetCount} · ${task.source_kind} · ${task.status}`
                    : task.status}
                </p>
              </div>
              <div className="actions">
                {[
                  ["pause", "PAUSE"],
                  ["resume", "RESUME"],
                  ["stop", "STOP"],
                ].map(([a, l]) => (
                  <button
                    disabled={
                      busy || (task.status === "completed" && a === "resume")
                    }
                    key={a}
                    onClick={() =>
                      action(`agent/tasks/${selected}/control`, { action: a })
                    }
                  >
                    {l}
                  </button>
                ))}
              </div>
            </section>
            <div className="agent-counts">
              {[
                ["Доступных подписчиков", task.counts.discovered],
                ["Подходят критериям", task.counts.qualified],
                ["Офферов к проверке", task.counts.prepared],
                ["Исключено / ошибки", task.counts.rejected],
              ].map(([label, n]) => (
                <div key={label}>
                  <strong>{n}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {task.error && (
              <div role="alert" className="agent-blocker">
                <strong>НУЖНО ДЕЙСТВИЕ ОПЕРАТОРА</strong>
                <p>{task.error}</p>
                <p>
                  После исправления подключения нажмите RESUME. Завершённые шаги
                  и курсор не потеряны.
                </p>
              </div>
            )}
            <div className="agent-tabs">
              {[
                ["chat", "Чат"],
                ["results", `Результаты / ${ready.length}`],
                ["tools", "Инструменты и прогресс"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value as any)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "chat" && (
              <div className="agent-messages">
                {task.messages.map((m: any) => (
                  <article
                    key={m.id}
                    className={m.role === "user" ? "user" : "assistant"}
                  >
                    <small>
                      {m.role === "user" ? "ВЫ" : "HIDEKI AGENT"} /{" "}
                      {new Date(m.created_at).toLocaleTimeString("ru")}
                    </small>
                    <p>{m.body}</p>
                  </article>
                ))}
                {task.status === "running" && (
                  <p className="agent-working">
                    ● Выполняется:{" "}
                    {task.steps.find((s: any) => s.status === "running")
                      ?.tool || task.phase}
                  </p>
                )}
                <div className="agent-suggestions">
                  {[
                    "убери агентства",
                    "обработай ещё 20",
                    "переделай офферы без вопросов",
                  ].map((t) => (
                    <button
                      key={t}
                      disabled={busy}
                      onClick={() =>
                        action(`agent/tasks/${selected}/chat`, { text: t })
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tab === "tools" && (
              <div className="agent-tools">
                {!task.steps.length && (
                  <p className="muted">
                    Ожидает worker. Запустите npm run worker в отдельном
                    терминале.
                  </p>
                )}
                {task.steps.map((s: any) => (
                  <details
                    key={s.id}
                    open={s.status === "failed" || s.status === "running"}
                  >
                    <summary>
                      <span>{s.tool}</span>
                      <span className="tag">{s.status}</span>
                      <time>
                        {new Date(s.started_at).toLocaleTimeString("ru")}
                      </time>
                    </summary>
                    <p>
                      Вход: <code>{JSON.stringify(s.input)}</code>
                    </p>
                    {s.error && <p className="error">{s.error}</p>}
                    {s.result && <pre>{JSON.stringify(s.result, null, 2)}</pre>}
                  </details>
                ))}
              </div>
            )}
            {tab === "results" && (
              <div className="agent-results">
                <div className="panelhead">
                  <h2>Traceable prospects</h2>
                  <button
                    className="primary"
                    disabled={busy || !ready.length}
                    onClick={() =>
                      action(`agent/tasks/${selected}/approve`, {})
                    }
                  >
                    ОДОБРИТЬ ВСЕ ПОДГОТОВЛЕННЫЕ
                  </button>
                </div>
                <p className="muted">
                  Одобрение не означает отправку. Глобальная очередь включается
                  отдельно в CRM → Outreach; провайдер должен разрешать отправку
                  конкретному получателю.
                </p>
                {!candidates.length && (
                  <p>
                    Реальные кандидаты появятся после успешного getFollowers.
                    Подставных профилей здесь нет.
                  </p>
                )}
                {candidates.map((c: any) => (
                  <article className="agent-candidate" key={c.id}>
                    <div className="panelhead">
                      <div>
                        <a
                          href={"https://www.instagram.com/" + c.handle + "/"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          @{c.handle} ↗
                        </a>
                        <small>
                          Подписчик @{c.source_handle} · {c.stage} ·{" "}
                          {c.score ?? "—"}/100
                        </small>
                      </div>
                      <span className="tag">
                        {c.message_status ||
                          c.location_evidence?.status ||
                          "ОЖИДАЕТ АНАЛИЗА"}
                      </span>
                    </div>
                    {c.profile && <p>{c.profile.bio}</p>}
                    {c.location_evidence && (
                      <div className="agent-evidence">
                        <strong>
                          Локация: {c.location_evidence.status} /{" "}
                          {c.location_evidence.confidence}
                        </strong>
                        <p>{c.location_evidence.reason}</p>
                        {c.location_evidence.evidence.map((e: any) => (
                          <blockquote key={e.id}>
                            {e.quote}
                            <a href={e.url} target="_blank" rel="noreferrer">
                              Источник ↗
                            </a>
                          </blockquote>
                        ))}
                      </div>
                    )}
                    {c.assessment && (
                      <>
                        <p>{c.assessment.rationale}</p>
                        <p className="muted">{c.assessment.limitation}</p>
                      </>
                    )}
                    {c.posts.length > 0 ? (
                      <details>
                        <summary>
                          Последние доступные публикации / {c.posts.length}
                        </summary>
                        {c.posts.map((p: any, i: number) => (
                          <blockquote key={i}>
                            {p.caption}
                            <small>
                              {p.publishedAt || "Дата не предоставлена"}
                            </small>
                            {p.url ? (
                              <a href={p.url} target="_blank" rel="noreferrer">
                                Публикация ↗
                              </a>
                            ) : (
                              <small>
                                Источник не предоставил ссылку на публикацию.
                              </small>
                            )}
                          </blockquote>
                        ))}
                      </details>
                    ) : (
                      c.stage !== "profile" && (
                        <p className="muted">
                          Доступные публикации не получены; агент не выдумывает
                          их содержимое.
                        </p>
                      )
                    )}
                    {(c.rejection || c.error) && (
                      <p className="error">{c.rejection || c.error}</p>
                    )}
                    {c.message_body && (
                      <div className="agent-draft">
                        <small>
                          ВЫБРАННОЕ СООБЩЕНИЕ / {c.selection?.selected}
                        </small>
                        <p>{c.message_body}</p>
                        <p className="muted">{c.selection?.reason}</p>
                        <div className="actions">
                          <button
                            disabled={busy}
                            onClick={() =>
                              action(`agent/tasks/${selected}/approve`, {
                                candidateIds: [c.id],
                              })
                            }
                          >
                            ОДОБРИТЬ
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  c.message_body,
                                );
                                setNotice(
                                  "Сообщение скопировано. Откройте профиль для ручной отправки.",
                                );
                              } catch {
                                setNotice(
                                  "Выделите текст и скопируйте вручную.",
                                );
                              }
                            }}
                          >
                            КОПИРОВАТЬ
                          </button>
                          <a
                            className="button"
                            href={"https://www.instagram.com/" + c.handle + "/"}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ПЕРЕЙТИ К ПРОФИЛЮ ↗
                          </a>
                        </div>
                      </div>
                    )}
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() => {
                          setTab("chat");
                          action(`agent/tasks/${selected}/chat`, {
                            text: `почему выбрал @${c.handle}?`,
                          });
                        }}
                      >
                        ПОЧЕМУ ЭТОТ КАНДИДАТ?
                      </button>
                      <a className="button" href="/crm">
                        РЕДАКТИРОВАТЬ ОФФЕРЫ В CRM ↗
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">Загрузка памяти задачи…</p>
        )}
        <form className="agent-composer" onSubmit={submit}>
          <label htmlFor="agent-prompt">
            {selected
              ? "Уточнение задачи или вопрос агенту"
              : "Задача агенту на естественном языке"}
          </label>
          <textarea
            id="agent-prompt"
            placeholder={
              selected
                ? "Почему выбрал @brand? Обработай ещё 20…"
                : "Проанализируй подписчиков @alexandro_hideki, найди клиентов из Москвы…"
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            required
            maxLength={selected ? 4000 : 8000}
          />
          <div>
            <label>
              Источник
              <select
                aria-label="Источник Instagram"
                value={selected ? task?.source_kind || source : source}
                disabled={!!selected}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="browser">Авторизованный браузер</option>
                <option value="http">HTTP provider / API</option>
              </select>
            </label>
            <button
              className="primary"
              type="submit"
              disabled={busy || !prompt.trim()}
            >
              {busy ? "СОХРАНЯЕМ…" : selected ? "ОТПРАВИТЬ" : "START →"}
            </button>
          </div>
          <p>
            Задачи исполняет отдельный worker. Начатые действия видны во вкладке
            инструментов. Автоматического обхода ограничений Instagram нет.
          </p>
        </form>
        <footer>
          <span>HIDEKI / AI AGENT V2</span>
          <span>OBSERVE · REASON · PREPARE</span>
        </footer>
      </main>
    </div>
  );
}
