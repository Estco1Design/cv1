"use client";
import { useEffect, useState } from "react";
const sections = [
  "Dashboard",
  "Lead Discovery",
  "Lead Database",
  "Profile Intelligence",
  "Offer Studio",
  "Outreach",
  "Analytics",
  "Settings",
];
const labels = [
  "Fashion / 25",
  "Потребность / 25",
  "Эстетика / 20",
  "Коммерция / 15",
  "Активность / 15",
];
export default function Home() {
  const [section, setSection] = useState("Dashboard"),
    [data, setData] = useState<any>(null),
    [detail, setDetail] = useState<any>(null),
    [selected, setSelected] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [priority, setPriority] = useState("all"),
    [url, setUrl] = useState(""),
    [csv, setCsv] = useState(""),
    [form, setForm] = useState<any>(null),
    [filters, setFilters] = useState<any>({
      country: "",
      city: "",
      clientType: "",
      topic: "",
      keywords: "",
      activity: "",
      commercial: "",
      aesthetic: "",
    });
  async function load() {
    try {
      const r = await fetch("/api/state");
      if (!r.ok) throw new Error("Не удалось загрузить данные");
      const d = await r.json();
      setData(d);
      setForm((f: any) => f || d.settings);
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function open(id: string, target = "Profile Intelligence") {
    setSelected(id);
    setSection(target);
    const r = await fetch("/api/leads/" + id);
    const d = await r.json();
    if (r.ok) setDetail(d);
    else setNotice(d.error);
  }
  async function act(path: string, body: any) {
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
      setNotice(
        d.message ||
          (d.added !== undefined
            ? `Добавлено: ${d.added}; дубликатов: ${d.duplicates || 0}${d.errors?.length ? " · " + d.errors.join("; ") : ""}`
            : "Сохранено"),
      );
      await load();
      if (selected) {
        const dr = await fetch("/api/leads/" + selected);
        if (dr.ok) setDetail(await dr.json());
      }
      return d;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const t = setInterval(async () => {
      const r = await fetch("/api/leads/" + selected);
      if (r.ok) setDetail(await r.json());
    }, 4000);
    return () => clearInterval(t);
  }, [selected]);
  if (!data)
    return (
      <main className="loading">
        <span className="brand">
          HIDEKI<span> / SALES INTELLIGENCE</span>
        </span>
        <p>{notice || "Подключаем рабочее пространство…"}</p>
      </main>
    );
  const workerOnline = Date.now() - data.settings.workerHeartbeat < 180000;
  const leads = data.leads.filter(
    (l: any) =>
      (l.username + " " + l.name + " " + l.category)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (priority === "all" ||
        (priority === "hot" && l.score >= 75) ||
        (priority === "warm" && l.score >= 50 && l.score < 75) ||
        (priority === "low" && l.score !== null && l.score < 50) ||
        (priority === "new" && l.score === null)),
  );
  const scoreTag = (l: any) => (
    <span className={"tag " + (l.score >= 75 ? "hot" : "")}>
      {l.score === null
        ? "НЕ ОЦЕНЁН"
        : `${l.score} / ${l.score >= 75 ? "HOT" : l.score >= 50 ? "WARM" : "LOW"}`}
    </span>
  );
  const leadTable = () => (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Профиль / клиент</th>
            <th>Источник</th>
            <th>Квалификация</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l: any) => (
            <tr key={l.id}>
              <td>
                <button className="textbutton" onClick={() => open(l.id)}>
                  @{l.username}
                </button>
                <small>
                  {l.name || "Имя ещё не получено"} {l.demo ? "· DEMO" : ""}
                </small>
              </td>
              <td>{l.source}</td>
              <td>
                {scoreTag(l)}
                <small>
                  {l.confidence
                    ? `Уверенность: ${l.confidence}`
                    : "Нет анализа"}
                </small>
              </td>
              <td>
                {l.opted_out
                  ? "Отказ от контакта"
                  : l.blocked
                    ? "Чёрный список"
                    : l.outcome || l.status}
              </td>
              <td>
                <button
                  className="iconbutton"
                  aria-label={"Открыть " + l.username}
                  onClick={() => open(l.id)}
                >
                  ↗
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!leads.length && (
        <Empty
          text="База пока пуста"
          sub="Добавьте профиль или CSV в Lead Discovery. Все метрики рассчитываются по вашей базе."
        />
      )}
    </div>
  );
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          HIDEKI<span>SALES INTELLIGENCE / V1</span>
        </a>
        <div className="workspace">
          <i /> ALEXANDER HIDEKI <small>PRIVATE WORKSPACE</small>
        </div>
        <a className="agent-back" href="/">
          ← Agent Chat / V2
        </a>
        <nav>
          {sections.map((s, i) => (
            <button
              key={s}
              aria-label={s}
              aria-current={section === s ? "page" : undefined}
              className={section === s ? "active" : ""}
              onClick={() => setSection(s)}
            >
              <span className="navnum">0{i + 1}</span>
              {s}
              <span className="arrow">↗</span>
            </button>
          ))}
        </nav>
        <div className="asidefoot">
          FASHION IS A BUSINESS.
          <br />
          MAKE THE CONNECTION.<small>Локальная база · SQLite / WAL</small>
        </div>
      </aside>
      <main>
        <header>
          <span>WORKSPACE / {section.toUpperCase()}</span>
          <span className="status">
            <i /> AGENT: {data.settings.agent.toUpperCase()}
          </span>
        </header>
        <div className="pageheading">
          <div>
            <p className="eyebrow">HIDEKI SALES AGENT / 01</p>
            <h1>
              {section === "Dashboard" ? (
                <>
                  The next
                  <br />
                  <em>connection.</em>
                </>
              ) : (
                section
              )}
            </h1>
          </div>
          <div className="headingnote">
            Fashion photography.
            <br />
            Meaningful conversations.<p>Поиск → понимание → предложение.</p>
          </div>
        </div>
        <div className="controlbar">
          <div>
            <span className="label">
              AGENT CONTROL · WORKER {workerOnline ? "ONLINE" : "OFFLINE"}
            </span>
            <strong>
              {data.settings.agent === "running"
                ? workerOnline
                  ? "Обработка очереди заданий"
                  : "Задания ожидают запуска worker"
                : data.settings.agent === "paused"
                  ? "Пауза после текущего шага"
                  : "Агент остановлен"}
            </strong>
          </div>
          <div className="actions">
            {[
              ["start", "START ↗"],
              ["pause", "PAUSE"],
              ["resume", "RESUME"],
              ["stop", "STOP"],
            ].map(([action, text]) => (
              <button
                key={action}
                disabled={busy}
                className={action === "start" ? "primary" : ""}
                onClick={() => act("agent", { action })}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <div role="status" className="notice">
            <span>{notice}</span>
            <button
              aria-label="Закрыть уведомление"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}
        {section === "Dashboard" && (
          <>
            <div className="metrics">
              {[
                ["Найдено аккаунтов", data.stats.total],
                ["Квалифицировано", data.stats.qualified],
                ["Офферов создано", data.stats.offers],
                ["Сообщений отправлено", data.stats.sent],
              ].map(([label, value], i) => (
                <article key={label}>
                  <span className="metricnum">0{i + 1} /</span>
                  <strong>{String(value).padStart(2, "0")}</strong>
                  <p>{label}</p>
                </article>
              ))}
            </div>
            <div className="split">
              <section className="panel">
                <div className="panelhead">
                  <h2>Pipeline overview</h2>
                  <span>LIVE DATA</span>
                </div>
                {[
                  ["Ответы", data.stats.replies],
                  ["Переговоры", data.stats.negotiations],
                  ["Продажи", data.stats.sales],
                ].map(([label, n]) => (
                  <div className="pipeline" key={label}>
                    <span>{label}</span>
                    <div className="track">
                      <div
                        style={{
                          width: `${data.stats.total ? (Number(n) / data.stats.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{n}</strong>
                  </div>
                ))}
                <p className="muted">
                  Ответы и результаты фиксируются вручную. DEMO-лиды явно
                  отмечены в базе.
                </p>
              </section>
              <section className="panel dark">
                <span className="eyebrow">YOUR NEXT MOVE</span>
                <h2>
                  Хороший контакт
                  <br />
                  начинается с внимания.
                </h2>
                <p>
                  Добавьте профиль, изучите факты и подготовьте обращение с
                  конкретной идеей.
                </p>
                <button onClick={() => setSection("Lead Discovery")}>
                  DISCOVER LEADS ↗
                </button>
              </section>
            </div>
            <div className="panelhead">
              <h2>Lead directory</h2>
              <button onClick={() => setSection("Lead Database")}>
                ВСЯ БАЗА ↗
              </button>
            </div>
            {leadTable()}
          </>
        )}
        {section === "Lead Discovery" && (
          <>
            <div className="split">
              <section className="panel">
                <span className="eyebrow">01 / MANUAL IMPORT</span>
                <h2>Добавить профиль</h2>
                <p className="muted">
                  Ссылка сохраняется сразу. Данные загружает только подключённый
                  источник.
                </p>
                <label>
                  Instagram URL или @username
                  <input
                    placeholder="https://www.instagram.com/brand/"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !url}
                  onClick={() => act("import", { url })}
                >
                  ДОБАВИТЬ ↗
                </button>
              </section>
              <section className="panel">
                <span className="eyebrow">02 / CSV IMPORT</span>
                <h2>Импорт базы</h2>
                <p className="muted">
                  UTF-8 CSV, колонка url, instagram_url или username. До 1000
                  строк. Профили дедуплицируются.
                </p>
                <input
                  aria-label="CSV файл"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setCsv(await f.text());
                  }}
                />
                <textarea
                  aria-label="CSV содержимое"
                  placeholder={"url\nhttps://www.instagram.com/brand/"}
                  value={csv}
                  onChange={(e) => setCsv(e.target.value)}
                />
                <button
                  disabled={busy || !csv}
                  onClick={() => act("import", { csv })}
                >
                  ИМПОРТИРОВАТЬ CSV ↗
                </button>
              </section>
            </div>
            <section className="panel">
              <div className="panelhead">
                <h2>Provider discovery</h2>
                <span>
                  {data.settings.profileUrl ? "НАСТРОЕН" : "НЕ ПОДКЛЮЧЁН"}
                </span>
              </div>
              <p className="muted">
                Поиск выполняет ваш авторизованный API-поставщик. Фильтры
                передаются источнику, фактическая поддержка зависит от него.
              </p>
              <div className="formgrid">
                {Object.entries({
                  country: "Страна",
                  city: "Город",
                  clientType: "Тип клиента",
                  topic: "Тематика",
                  keywords: "Ключевые слова",
                  activity: "Активность",
                  commercial: "Коммерческие публикации",
                  aesthetic: "Эстетика",
                }).map(([k, v]) => (
                  <label key={k}>
                    {v}
                    <input
                      value={filters[k]}
                      onChange={(e) =>
                        setFilters({ ...filters, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                disabled={busy}
                onClick={() => act("discover", { filters })}
              >
                НАЙТИ ЧЕРЕЗ PROVIDER ↗
              </button>
            </section>
            <section className="demobox">
              <div>
                <strong>DEMO / ИЗОЛИРОВАННЫЙ ТЕСТОВЫЙ ПРОФИЛЬ</strong>
                <p>
                  Вымышленный бренд и тестовые офферы. AI не вызывается;
                  отправка запрещена.
                </p>
              </div>
              <button disabled={busy} onClick={() => act("demo", {})}>
                ДОБАВИТЬ DEMO
              </button>
            </section>
          </>
        )}
        {section === "Lead Database" && (
          <>
            <div className="filters">
              <input
                aria-label="Поиск лидов"
                placeholder="Поиск по имени, username, категории…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Приоритет"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="all">Все приоритеты</option>
                <option value="hot">HOT / 75–100</option>
                <option value="warm">WARM / 50–74</option>
                <option value="low">LOW / 0–49</option>
                <option value="new">Не оценены</option>
              </select>
              <button onClick={() => setSection("Lead Discovery")}>
                + ИМПОРТ
              </button>
            </div>
            {leadTable()}
            <p className="muted">
              Скоринг — рабочая эвристика, не вероятность покупки.
            </p>
          </>
        )}
        {["Profile Intelligence", "Offer Studio"].includes(section) && (
          <>
            <label className="leadselect">
              ВЫБРАТЬ ЛИДА
              <select
                value={selected}
                onChange={(e) => open(e.target.value, section)}
              >
                <option value="">Выберите профиль</option>
                {data.leads.map((l: any) => (
                  <option key={l.id} value={l.id}>
                    @{l.username}
                    {l.demo ? " / DEMO" : ""}
                  </option>
                ))}
              </select>
            </label>
            {!detail ? (
              <Empty
                text="Начните с профиля"
                sub="Выберите импортированного клиента для анализа и работы над предложением."
              />
            ) : (
              <>
                <section className="profilehero">
                  <div className="avatar">
                    {detail.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <span className="eyebrow">
                      {detail.demo
                        ? "DEMO / ВЫМЫШЛЕННЫЙ ПРОФИЛЬ"
                        : detail.source}
                    </span>
                    <h2>@{detail.username}</h2>
                    <p>{detail.name || "Имя не получено"}</p>
                  </div>
                  {scoreTag(detail)}
                  <a
                    className="button"
                    href={detail.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ПРОФИЛЬ ↗
                  </a>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      act("agent", { action: "start", leadId: detail.id })
                    }
                  >
                    АНАЛИЗ → ОФФЕРЫ
                  </button>
                </section>
                {section === "Profile Intelligence" ? (
                  <>
                    <div className="split">
                      <section className="panel">
                        <h2>Source intelligence</h2>
                        {detail.snapshots[0] ? (
                          <>
                            <p>
                              {detail.snapshots[0].data.bio ||
                                "Описание отсутствует"}
                            </p>
                            <dl>
                              {["category", "country", "city", "followers"].map(
                                (k) => (
                                  <div key={k}>
                                    <dt>{k}</dt>
                                    <dd>
                                      {detail.snapshots[0].data[k] ??
                                        "Нет данных"}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                            <p>
                              Ссылки:{" "}
                              {detail.snapshots[0].data.links.join(", ") ||
                                "нет данных"}
                            </p>
                            <p>
                              Контакты:{" "}
                              {detail.snapshots[0].data.contacts.join(", ") ||
                                "нет данных"}
                            </p>
                            <h3>Доступные публикации</h3>
                            {detail.snapshots[0].data.posts.length ? (
                              detail.snapshots[0].data.posts.map(
                                (p: any, i: number) => (
                                  <blockquote key={i}>
                                    {p.caption}
                                    <small>
                                      {p.publishedAt || "Дата неизвестна"}{" "}
                                      {p.imageUrl
                                        ? "· Изображение доступно источнику"
                                        : ""}
                                    </small>
                                  </blockquote>
                                ),
                              )
                            ) : (
                              <p className="muted">
                                Публикации недоступны. Это ограничивает
                                уверенность анализа.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="muted">
                            Данных источника пока нет. Запустите анализ; без
                            provider профиль не будет выдуман.
                          </p>
                        )}
                      </section>
                      <section className="panel">
                        <h2>Qualification dossier</h2>
                        {detail.assessments[0] ? (
                          <>
                            <p className="tag">
                              {detail.assessments[0].data.limitation}
                            </p>
                            {[
                              "summary",
                              "aesthetic",
                              "need",
                              "proposal",
                              "personalization",
                            ].map((k) => (
                              <div className="dossier" key={k}>
                                <small>
                                  {
                                    (
                                      {
                                        summary: "О клиенте",
                                        aesthetic: "Эстетика",
                                        need: "Потребность",
                                        proposal: "Что предложить",
                                        personalization: "Персональная деталь",
                                      } as any
                                    )[k]
                                  }
                                </small>
                                <p>{detail.assessments[0].data[k]}</p>
                              </div>
                            ))}
                            <h3>Подтверждено данными</h3>
                            <ul>
                              {detail.assessments[0].data.facts.map(
                                (f: string) => (
                                  <li key={f}>{f}</li>
                                ),
                              )}
                            </ul>
                            <h3>Гипотезы</h3>
                            <ul>
                              {detail.assessments[0].data.hypotheses.map(
                                (f: string) => (
                                  <li key={f}>{f}</li>
                                ),
                              )}
                            </ul>
                            {detail.assessments[0].data.evidence.map(
                              (e: string, i: number) => (
                                <div className="evidence" key={i}>
                                  <strong>
                                    {labels[i].split(" /")[0]} /{" "}
                                    {Math.round(
                                      detail.assessments[0].data.dimensions[i] *
                                        100,
                                    )}
                                    %
                                  </strong>
                                  <p>{e}</p>
                                </div>
                              ),
                            )}
                            <button onClick={() => setSection("Offer Studio")}>
                              ОТКРЫТЬ ОФФЕРЫ ↗
                            </button>
                          </>
                        ) : (
                          <p className="muted">Анализ ещё не выполнен.</p>
                        )}
                      </section>
                    </div>
                    <section className="panel">
                      <h2>Contact controls</h2>
                      <div className="actions">
                        <button
                          onClick={() =>
                            act("lead", {
                              id: detail.id,
                              blocked: !detail.blocked,
                            })
                          }
                        >
                          {detail.blocked
                            ? "УБРАТЬ ИЗ ЧЁРНОГО СПИСКА"
                            : "В ЧЁРНЫЙ СПИСОК"}
                        </button>
                        <button
                          onClick={() =>
                            act("lead", {
                              id: detail.id,
                              opted_out: !detail.opted_out,
                            })
                          }
                        >
                          {detail.opted_out
                            ? "ВОЗОБНОВИТЬ КОНТАКТ"
                            : "ОТКАЗ ОТ СООБЩЕНИЙ"}
                        </button>
                        <select
                          aria-label="Результат переговоров"
                          value={detail.outcome}
                          onChange={(e) =>
                            act("lead", {
                              id: detail.id,
                              outcome: e.target.value,
                            })
                          }
                        >
                          <option value="">Без результата</option>
                          <option value="negotiation">Переговоры</option>
                          <option value="sale">Продажа</option>
                          <option value="declined">Отказ</option>
                        </select>
                      </div>
                      <Reply
                        onSubmit={(body) =>
                          act("reply", { leadId: detail.id, body })
                        }
                      />
                      {detail.conversations.map((c: any) => (
                        <blockquote key={c.id}>
                          {c.body}
                          <small>{c.created_at} / вручную</small>
                        </blockquote>
                      ))}
                    </section>
                  </>
                ) : (
                  <div className="offers">
                    {detail.offers.length ? (
                      detail.offers.map((o: any) => (
                        <Offer
                          key={o.id}
                          offer={o}
                          busy={busy}
                          save={(body) => act("offer", { id: o.id, body })}
                          queue={() => act("queue", { offerId: o.id })}
                        />
                      ))
                    ) : (
                      <Empty
                        text="Офферы ещё не созданы"
                        sub="Запустите анализ профиля. Подходящие лиды получат три варианта и отдельную оценку."
                      />
                    )}
                  </div>
                )}
                <section className="panel">
                  <h2>История профиля</h2>
                  <small>
                    Снимков: {detail.snapshots.length} / Анализов:{" "}
                    {detail.assessments.length}
                  </small>
                  {detail.activities.map((a: any) => (
                    <div className="log" key={a.id}>
                      <time>{new Date(a.created_at).toLocaleString("ru")}</time>
                      <strong>{a.event}</strong>
                      <span>{a.detail}</span>
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
        {section === "Outreach" && (
          <>
            <section className="panel">
              <div className="panelhead">
                <h2>Delivery controls</h2>
                <span className="tag">
                  {data.settings.mode.toUpperCase()} MODE
                </span>
              </div>
              <p>
                Пауза очереди независима от агента. Интервал:{" "}
                {data.settings.minIntervalSeconds} сек. Доступность отправки
                проверяется у провайдера для каждого получателя.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  act("queue-control", { paused: !data.settings.queuePaused })
                }
              >
                {data.settings.queuePaused
                  ? "ЗАПУСТИТЬ ОЧЕРЕДЬ"
                  : "ОСТАНОВИТЬ ОЧЕРЕДЬ"}
              </button>
              <p className="muted">
                Без разрешённого API: скопируйте текст, откройте профиль и
                отправьте вручную. Кнопка «Отправлено вручную» — ваша отметка,
                не подтверждение Instagram.
              </p>
            </section>
            {!data.messages.length && (
              <Empty
                text="Очередь пуста"
                sub="Здесь появятся выбранные офферы после обработки лидов."
              />
            )}
            {data.messages.map((m: any) => (
              <section className="panel" key={m.id}>
                <div className="panelhead">
                  <h2>
                    @{m.username} {m.demo ? " / DEMO" : ""}
                  </h2>
                  <span className="tag">{m.status}</span>
                </div>
                <p className="messagebody">{m.body}</p>
                {m.error && <p className="error">{m.error}</p>}
                <small>
                  ID: {m.id} / Режим: {m.mode} / Попыток: {m.attempts}
                </small>
                <div className="actions">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(m.body);
                        setNotice("Текст скопирован");
                      } catch {
                        setNotice(
                          "Копирование недоступно: выделите текст вручную",
                        );
                      }
                    }}
                  >
                    КОПИРОВАТЬ
                  </button>
                  <a
                    className="button"
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    ПРОФИЛЬ ↗
                  </a>
                  {!m.demo &&
                    ![
                      "sent",
                      "sent_manual",
                      "delivery_unknown",
                      "sending",
                      "cancelled",
                    ].includes(m.status) && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act("message", { id: m.id, action: "approve" })
                          }
                        >
                          ОДОБРИТЬ
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            act("message", { id: m.id, action: "manual" })
                          }
                        >
                          ОТПРАВЛЕНО ВРУЧНУЮ
                        </button>
                        <button
                          onClick={() =>
                            act("message", { id: m.id, action: "cancel" })
                          }
                        >
                          ОТМЕНИТЬ
                        </button>
                      </>
                    )}
                </div>
              </section>
            ))}
          </>
        )}
        {section === "Analytics" && (
          <>
            <div className="metrics">
              {[
                [
                  "Ответы / отправки",
                  data.stats.sent
                    ? Math.round((data.stats.replies / data.stats.sent) * 100) +
                      "%"
                    : "—",
                ],
                [
                  "Продажи / лиды",
                  data.stats.total
                    ? Math.round((data.stats.sales / data.stats.total) * 100) +
                      "%"
                    : "—",
                ],
                ["Ответов", data.stats.replies],
                ["Продаж", data.stats.sales],
              ].map(([k, v]) => (
                <article key={k}>
                  <strong>{v}</strong>
                  <p>{k}</p>
                </article>
              ))}
            </div>
            <section className="panel">
              <h2>Эффективность источников</h2>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>Источник</th>
                      <th>Лидов</th>
                      <th>Средний балл</th>
                      <th>Продаж</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analytics.map((a: any) => (
                      <tr key={a.source}>
                        <td>{a.source}</td>
                        <td>{a.total}</td>
                        <td>
                          {a.avg_score === null ? "—" : Math.round(a.avg_score)}
                        </td>
                        <td>{a.sales}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                Используйте результаты и сохранённые ответы для обновления базы
                знаний и весов. Автоматическое переобучение в V1 не выполняется.
              </p>
            </section>
          </>
        )}
        {section === "Settings" && form && (
          <>
            <section className="panel">
              <div className="panelhead">
                <h2>AI connection</h2>
                <span>SERVER-SIDE ONLY</span>
              </div>
              <p className="muted">
                FreeLLMAPI должен быть доступен с машины, где работает сервер
                приложения. Для VPS используйте защищённый сетевой доступ или
                облачный OpenAI-compatible endpoint.
              </p>
              <div className="formgrid">
                {[
                  ["provider", "Provider"],
                  ["baseUrl", "Base URL"],
                  ["model", "Default model"],
                  ["analysisModel", "Profile analysis model"],
                  ["generationModel", "Text generation model"],
                  ["evaluationModel", "Offer evaluation model"],
                  ["visionModel", "Vision model (пусто = только текст)"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      value={form[k]}
                      onChange={(e) =>
                        setForm({ ...form, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  API style
                  <select
                    value={form.apiStyle}
                    onChange={(e) =>
                      setForm({ ...form, apiStyle: e.target.value })
                    }
                  >
                    <option value="auto">
                      Auto: Chat → Responses on 404/405
                    </option>
                    <option value="chat">Chat Completions</option>
                    <option value="responses">Responses</option>
                  </select>
                </label>
                {[
                  ["temperature", "Temperature"],
                  ["maxTokens", "Max output tokens"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      type="number"
                      step={k === "temperature" ? 0.1 : 1}
                      value={form[k]}
                      onChange={(e) =>
                        setForm({ ...form, [k]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <label>
                  API key {form.apiKeyConfigured ? "· настроен" : ""}
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder="Пусто — сохранить существующий"
                    value={form.apiKey || ""}
                    onChange={(e) =>
                      setForm({ ...form, apiKey: e.target.value })
                    }
                  />
                </label>
              </div>
              <div className="actions">
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => act("settings", form)}
                >
                  СОХРАНИТЬ НАСТРОЙКИ
                </button>
                <button disabled={busy} onClick={() => act("ai-test", {})}>
                  TEST SAVED CONNECTION ↗
                </button>
              </div>
            </section>
            <section className="panel">
              <h2>Data & outreach providers</h2>
              <div className="formgrid">
                {[
                  ["profileUrl", "Profile provider URL"],
                  ["profileKey", "Profile API key"],
                  ["outreachUrl", "Outreach provider URL"],
                  ["outreachKey", "Outreach API key"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      type={k.endsWith("Key") ? "password" : "text"}
                      value={form[k] || ""}
                      placeholder={
                        k.endsWith("Key")
                          ? "Пусто — сохранить существующий"
                          : ""
                      }
                      onChange={(e) =>
                        setForm({ ...form, [k]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <label>
                  Режим новых сообщений
                  <select
                    value={form.mode}
                    onChange={(e) => setForm({ ...form, mode: e.target.value })}
                  >
                    <option value="draft">DRAFT</option>
                    <option value="approval">APPROVAL</option>
                    <option value="automated">
                      AUTOMATED / разрешения провайдера обязательны
                    </option>
                  </select>
                </label>
                <label>
                  Минимальный интервал (сек.)
                  <input
                    type="number"
                    min="60"
                    value={form.minIntervalSeconds}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        minIntervalSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
            </section>
            <section className="panel">
              <h2>Qualification weights</h2>
              <p className="muted">
                Веса нормализуются к 100. При недостатке данных уверенность
                снижается.
              </p>
              <div className="formgrid">
                {labels.map((l, i) => (
                  <label key={l}>
                    {l.split(" /")[0]}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.weights[i]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          weights: form.weights.map((v: number, j: number) =>
                            i === j ? Number(e.target.value) : v,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Порог создания офферов
                  <input
                    type="number"
                    value={form.threshold}
                    onChange={(e) =>
                      setForm({ ...form, threshold: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
            </section>
            <section className="panel">
              <h2>Alexander Hideki / Knowledge base</h2>
              <p className="muted">
                Добавьте подтверждённые материалы. AI получает эти данные при
                генерации и оценке.
              </p>
              <div className="formgrid">
                {Object.entries({
                  biography: "Биография",
                  portfolio: "Портфолио / ссылки и описание",
                  strengths: "Сильные стороны",
                  shootTypes: "Виды съёмок",
                  audience: "Целевая аудитория",
                  terms: "Условия сотрудничества",
                  examples: "Успешные сообщения",
                  forbidden: "Запрещённые формулировки",
                }).map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <textarea
                      value={form.knowledge[k]}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          knowledge: { ...form.knowledge, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => act("settings", form)}
              >
                СОХРАНИТЬ ВСЕ НАСТРОЙКИ ↗
              </button>
            </section>
          </>
        )}
        <section className="panel jobpanel">
          <div className="panelhead">
            <h2>Agent activity</h2>
            <span>6 CHECKPOINTS / PERSISTENT JOBS</span>
          </div>
          {!data.jobs.length ? (
            <p className="muted">
              Заданий пока нет. Импортируйте лидов и нажмите START. Для
              обработки нужен запущенный worker.
            </p>
          ) : (
            data.jobs.map((j: any) => (
              <div className="job" key={j.id}>
                <strong>@{j.username}</strong>
                <span className="tag">{j.status}</span>
                <span>
                  {
                    [
                      "Получение профиля",
                      "Анализ и скоринг",
                      "Три оффера",
                      "Оценка офферов",
                      "Очередь",
                      "Доступное действие",
                      "Завершено",
                    ][j.step]
                  }
                </span>
                <div className="checkpoints">
                  {Array.from({ length: 6 }, (_, i) => (
                    <i
                      key={i}
                      className={
                        i < j.step ? "done" : i === j.step ? "current" : ""
                      }
                    />
                  ))}
                </div>
                {j.error && <p className="error">{j.error}</p>}
              </div>
            ))
          )}
        </section>
        <footer>
          <span>HIDEKI / SALES INTELLIGENCE</span>
          <span>V1 · FACTS BEFORE OUTREACH</span>
        </footer>
      </main>
    </div>
  );
}
function Empty({ text, sub }: { text: string; sub: string }) {
  return (
    <div className="empty">
      <span>↗</span>
      <h3>{text}</h3>
      <p>{sub}</p>
    </div>
  );
}
function Offer({
  offer,
  busy,
  save,
  queue,
}: {
  offer: any;
  busy: boolean;
  save: (body: string) => void;
  queue: () => void;
}) {
  const [body, setBody] = useState(offer.body);
  const evaluation = JSON.parse(offer.evaluation);
  return (
    <section className={"panel offer " + (offer.selected ? "selected" : "")}>
      <div className="panelhead">
        <span className="variant">{offer.variant}</span>
        <span>
          {offer.selected ? "SELECTED / ЛУЧШИЙ ВАРИАНТ" : "ALTERNATIVE"}
        </span>
      </div>
      <h2>
        {
          (
            {
              A: "Personal recognition",
              B: "Creative collaboration",
              C: "Business value",
            } as any
          )[offer.variant]
        }
      </h2>
      <textarea
        aria-label={"Оффер " + offer.variant}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {evaluation.detail && (
        <>
          <div className="ratings">
            {evaluation.detail.scores.map((s: number, i: number) => (
              <span
                title={
                  [
                    "Персонализация",
                    "Достоверность",
                    "Соответствие",
                    "Естественность",
                    "Чёткость",
                    "Ненавязчивость",
                    "Стиль",
                  ][i]
                }
                key={i}
              >
                {s}/10
              </span>
            ))}
          </div>
          <p className="muted">{evaluation.detail.reason}</p>
          {!!offer.selected && <p>{evaluation.selectionReason}</p>}
        </>
      )}
      <div className="actions">
        <button
          disabled={busy || body === offer.body}
          onClick={() => save(body)}
        >
          СОХРАНИТЬ ТЕКСТ
        </button>
        <button disabled={busy || body !== offer.body} onClick={queue}>
          В ОЧЕРЕДЬ ↗
        </button>
      </div>
    </section>
  );
}
function Reply({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [body, setBody] = useState("");
  return (
    <div className="reply">
      <label>
        Зафиксировать полученный ответ
        <textarea value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <button
        disabled={!body}
        onClick={() => {
          onSubmit(body);
          setBody("");
        }}
      >
        СОХРАНИТЬ ОТВЕТ
      </button>
    </div>
  );
}
