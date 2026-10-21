# HIDEKI / SALES INTELLIGENCE

Самостоятельное приложение для работы с клиентами fashion-фотографа Александра Хидеки. Next.js App Router, TypeScript, React, Tailwind 4, SQLite (WAL), OpenAI-compatible AI, постоянная очередь заданий и отдельный worker. Не связано с RICHRUSSIANCOMMUNITY.

## Быстрый запуск на Mac

1. Установите **Node.js 24 LTS**, npm и Command Line Tools (`xcode-select --install`, если нет компилятора для better-sqlite3).
2. В папке проекта выполните:

```sh
npm ci
cp -n .env.example .env.local
openssl rand -hex 32
```

3. Запишите сгенерированное значение в `SETTINGS_ENCRYPTION_KEY` в `.env.local`. Задайте `APP_PASSWORD`; имя для входа — `hideki`. Не теряйте encryption key: без него сохранённые credentials не расшифровать.
4. Запустите веб-интерфейс:

```sh
npm run dev
```

Откройте локально `http://127.0.0.1:3000`. В **отдельном терминале из той же папки** запустите worker, загрузив тот же env-файл:

```sh
node --env-file=.env.local --import tsx scripts/worker.ts
```

`npm run worker` подходит, когда переменные уже экспортированы окружением. Next загружает `.env.local` сам; отдельный worker — нет. Оба процесса должны использовать один абсолютный DATABASE_PATH, если рабочие каталоги различаются.

База и схема создаются при первом обращении. Пустая база не содержит фейковых клиентов. `Lead Discovery → ДОБАВИТЬ DEMO` добавляет один явно вымышленный профиль. Нажмите START: worker выполнит 6 контрольных этапов; DEMO использует обозначенные тестовые данные и тексты без AI-вызова. Отправка DEMO запрещена на сервере.

## Реальный сценарий

1. Settings: заполните подтверждённую биографию, портфолио, сильные стороны, условия, примеры сообщений и запретные формулировки. Сохраните.
2. AI: локальный FreeLLMAPI `http://127.0.0.1:31415/v1`, модель `auto:coding`. При необходимости укажите отдельные model IDs для анализа, генерации, оценки и vision. Кнопка TEST проверяет **сохранённую** конфигурацию реальным запросом.
3. В облаке loopback указывает на облачную машину. Локальный Mac endpoint не станет доступен автоматически. Используйте защищённый туннель/VPN либо HTTPS cloud endpoint с API key. Приложение не требует FreeLLMAPI при сборке или тестах.
4. Подключите источник разрешённых данных по контракту ниже. Без него реальный Instagram URL сохраняется, но попытка анализа заканчивается видимой ошибкой источника. Универсального Instagram scraping здесь нет.
5. Добавьте URL / @username или CSV UTF-8. Поддерживаются колонки `url`, `instagram_url`, `username`. Дополнительные колонки не считаются проверенными данными профиля. Некорректные строки возвращаются списком ошибок. До 1000 строк; дубликаты нормализуются без query-параметров и регистра username.
6. START запускает новые подходящие контакты; можно запустить отдельного лида в досье. Шаги: источник → анализ/скоринг → три оффера → независимая AI-оценка → очередь → доступное действие. Низкий балл завершает обработку без оффера. Текстовые данные и просмотр изображений явно различаются. Без публикаций уверенность low.
7. В Offer Studio можно изменить текст до отправки. При изменении одобрение сбрасывается. Кнопка «В очередь» у другого варианта заменяет ещё не отправленный черновик с сохранением ID; после попытки отправки, неопределённого результата или отмены замена запрещена. В Outreach скопируйте текст и откройте профиль для ручной отправки. Отметка «отправлено вручную» — заявление оператора, не receipt Instagram.
8. Реальные ответы фиксируются вручную в досье. Там же устанавливаются результат переговоров, блокировка и отказ. Ответы/результаты влияют на метрики; знания и веса можно улучшать на основе истории. Автоматическое обучение и получение входящих webhooks в V1 не реализованы.

## Источник профилей: расширяемый HTTP adapter

`lib/providers.ts` определяет `ProfileSource` и `OutreachProvider`. Внешний поставщик может использовать разрешённый Instagram API или публичные данные в пределах своих разрешений. Никакого обхода CAPTCHA или блокировок.

Profile provider URL — полный endpoint, например `https://provider.example/profile`. Сервер делает POST, заголовок `Authorization: Bearer <key>` при наличии ключа:

```json
{ "url": "https://www.instagram.com/example/" }
```

Ответ (username обязателен и должен совпасть с запрошенным):

```json
{
  "username": "example",
  "name": "Example Brand",
  "bio": "Fashion label",
  "category": "Fashion brand",
  "country": "France",
  "city": "Paris",
  "links": ["https://example.com"],
  "contacts": ["studio@example.com"],
  "followers": 12000,
  "posts": [
    {
      "caption": "Collection campaign",
      "publishedAt": "2026-10-01T12:00:00Z",
      "imageUrl": "https://example.com/image.jpg"
    }
  ]
}
```

Недоступные поля опускаются, а не выдумываются. Provider обязан возвращать лишь данные, разрешённые его API. Секретные/авторизованные image URL не публикуйте: изображения передаются AI-провайдеру только при настроенной vision-модели (до 4). Текущая модель должна действительно поддерживать изображения.

Discovery: `POST <profileUrl>/discover` с `{"filters":{"country":"...","city":"...","clientType":"...","topic":"...","keywords":"...","activity":"...","commercial":"...","aesthetic":"..."}}`. Ответ `{"profiles":[...]}`. Фильтры реализует поставщик; приложение не утверждает, что любой провайдер поддерживает все фильтры. Discovery-снимки сохраняются; перед последующим анализом worker обновляет профиль через fetch.

## Отправка: capability-gated adapter

По умолчанию DRAFT, очередь приостановлена. Настройки режима действуют на **новые** сообщения, существующие сохраняют свой режим. Пауза агента и пауза отправки независимы. DRAFT не отправляется через API; APPROVAL требует одобрения каждого сообщения; AUTOMATED обрабатывается только после запуска очереди и проверки capability получателя.

Настройте outreach URL (например `https://provider.example/outreach`) и key. Провайдер обязан поддерживать два endpoint:

```text
POST /outreach/capabilities
request:  {"recipient":"https://www.instagram.com/example/","channel":"instagram"}
response: {"allowed":false,"reason":"Recipient has no eligible conversation"}

POST /outreach/send
request:  {"recipient":"...","text":"...","channel":"instagram","idempotencyKey":"persistent-message-uuid"}
response: {"id":"provider-message-id"}
```

`allowed:true` означает, что провайдер проверил действующие права именно для этого получателя. Провайдер **обязан гарантировать идемпотентность** по ключу. Официальный Instagram API не даёт универсальной отправки незнакомым пользователям; unsupported переводится в `manual_required`. В V1 нет встроенного Meta OAuth-коннектора.

UNIQUE(lead_id) предотвращает повторный outreach одному контакту. SQLite-транзакция резервирует отправку и глобальный интервал (минимум 60 секунд). Проверка blacklist/opt-out повторяется непосредственно перед резервированием. Отказ не может отозвать уже начавшийся внешний запрос. Timeout или crash во время отправки → `delivery_unknown`; автоматический повтор запрещён, необходима сверка с провайдером по message UUID. В V1 нет кнопки повторной отправки и follow-up кампаний.

## Задания и постоянство

Отдельный процесс worker опрашивает БД каждые 2 секунды. Индикатор ONLINE означает heartbeat за последние 180 секунд; режим агента и состояние процесса показываются раздельно. Claim, lease (180 секунд), checkpoint и результаты шага фиксируются транзакционно. Сетевой таймаут 45 секунд. После crash lease позволяет повторить незавершённый шаг; уже сохранённые офферы повторно не создаются. PAUSE применяется на границе шага; RESUME продолжает paused и failed jobs; STOP отменяет текущие и ожидающие задания. Новый START может создать задание вместо stopped, но не дублирует completed job или сообщение. Остановка агента не останавливает независимую очередь отправки — для неё отдельная кнопка.

AI-результаты валидируются Zod. Пять долей 0..1 взвешиваются и нормализуются к 100; это эвристика, не вероятность сделки. HOT 75+, WARM 50–74. Confidence и evidence сохраняются. AI может ошибаться: просматривайте досье/офферы перед контактом. Оценка офферов — отдельный вызов, 7 критериев; редактирование человека не выдаётся за повторную AI-оценку.

## Данные и переход на PostgreSQL

`lib/db.ts` — единая точка доступа SQLite, schema migration v1 при инициализации. Сущности: users, workspaces, instagram_accounts, lead_sources, leads, profile_snapshots, posts, lead_assessments, offers, outreach_messages, conversations, activities, campaigns, agent_jobs, ai_settings, audit_logs. В V1 один оператор/одно рабочее пространство; Users/Workspaces/Campaigns/InstagramAccounts/LeadSources — базовые таблицы для расширения, отдельного управления ими пока нет.

Бизнес-логика (`service`, `ai`, `providers`, `worker`) отделена от UI/HTTP. Для PostgreSQL потребуется заменить SQL repository и transaction/claim реализацию на PostgreSQL (`FOR UPDATE SKIP LOCKED`), сделать методы доступа async, миграцию схемы и перенос JSON/boolean/timestamp типов. AI-контракты и правила скоринга/отправки сохраняются. Автоматический переключатель DATABASE_URL в V1 не реализован. SQLite — сознательный выбор для одного VPS, без Redis. Не запускайте несколько Next-инстансов на независимых копиях базы.

## Проверки

```sh
npm run typecheck
npm test
npm run build
npm run smoke
npx playwright install chromium
npm run test:e2e
```

Unit/integration: настоящий SQLite и локальный HTTP mock server вместо платного AI/Instagram; CSV, дедупликация, ошибки источника, отсутствие публикаций, скоринг, генерация/оценка, очередь, запрет unsupported/DEMO/opt-out, конкурентная отправка, пауза/стоп, шифрование и сохранность после нового процесса. E2E: desktop/mobile UI, реальный импорт/перезагрузка базы, DEMO-маркировка, настройки. Эти проверки не подтверждают доступность вашего FreeLLMAPI или прав внешнего Instagram provider. GitHub Actions выполняет проверки без внешних ключей.

## VPS / 24×7

Node 24, один сервер с постоянным диском, `npm ci && npm run build`. Запустите **два отдельных сервиса** (systemd/launchd/процесс-менеджер): `npm start` и `node --env-file=.env.local --import tsx scripts/worker.ts` с одинаковым WorkingDirectory и DATABASE_PATH. Настройте перезапуск, логи, ограничение доступа и TLS reverse proxy. APP_PASSWORD обязателен в production; UI/API защищены HTTP Basic (`hideki`), используйте HTTPS. Development привязан к loopback, не выставляйте dev-сервер наружу. Production без пароля возвращает 503.

Credentials, введённые в UI, шифруются AES-256-GCM. Клиенту возвращаются только признаки configured, значения не передаются. Можно задать ключи через серверные переменные окружения; это не требует сохранения в UI. Настройки endpoint доступны доверенному оператору и могут обращаться к локальной сети: не давайте доступ посторонним. Не коммитьте `.env.local`, SQLite или резервные копии. Сохраняйте DB и encryption key раздельно, делайте backup SQLite через backup API либо останавливайте оба процесса перед файловым копированием (учитывайте WAL). Входящие публичные webhooks, многопользовательский RBAC, email/SMS connectors, миграция PostgreSQL и автоматическое обучение — последующие этапы.

## Структура

```text
app/                 UI, global styles, API route
lib/db.ts            schema, persistence primitives
lib/settings.ts      server-only config and credential encryption
lib/providers.ts     typed profile/discovery/outreach contracts
lib/ai.ts            AI transport, schemas, scoring, offer stages
lib/service.ts       imports, deduplication, jobs, history
lib/worker.ts        durable checkpoints and delivery guardrails
scripts/worker.ts    standalone process
middleware.ts        access control
 tests/              SQLite + provider integration tests
 e2e/                Playwright desktop/mobile scenarios
.github/workflows/   CI
```

Production smoke (`npm run smoke`, после сборки) запускает реальный Next server и отдельный worker с временной SQLite: проверяет авторизацию, блокировку чужого Origin, полный DEMO pipeline и сохранность после рестарта. Тест не отправляет внешних сообщений. Для системного Chromium можно задать `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.

## Файлы первой версии

Добавлены или изменены:

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `app/api/[...path]/route.ts`
- `app/globals.css`
- `app/layout.tsx`
- `app/page.tsx`
- `e2e/workspace.spec.ts`
- `lib/ai.ts`
- `lib/db.ts`
- `lib/providers.ts`
- `lib/service.ts`
- `lib/settings.ts`
- `lib/worker.ts`
- `middleware.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `postcss.config.mjs`
- `scripts/production-smoke.ts`
- `scripts/worker.ts`
- `tests/core.test.ts`
- `tsconfig.json`
