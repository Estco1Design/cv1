# Agent V2: runtime contract

## HTTP source adapter

В CRM → Settings укажите полный профильный endpoint, например `https://provider.example/profile`, и при необходимости server-side API key. Выберите HTTP provider при создании задачи. Поставщик обязан реально иметь право читать подписчиков исходного аккаунта; общедоступного универсального официального Instagram endpoint для этого не предполагается.

Запросы с `Authorization: Bearer <configured key>`:

```http
POST /profile/followers
Content-Type: application/json

{"handle":"alexandro_hideki","cursor":null,"limit":20}
```

```json
{
  "handles": ["actual_username"],
  "nextCursor": "provider_cursor",
  "hasMore": true,
  "limitation": "Only accessible followers"
}
```

`nextCursor` — строка или null. Для `hasMore:true` требуется новый непустой cursor; повтор того же cursor блокирует задачу. Handles нормализуются и дедуплицируются. Не возвращайте фиктивные значения. Последняя страница: `hasMore:false`, `nextCursor:null`. Не выдавайте ограниченный список за всех подписчиков. До 200 страниц и 2000 кандидатов на задачу; типичный default — максимум 300 (локальный fallback устанавливает отдельный объявленный лимит).

```http
POST /profile
Content-Type: application/json

{"url":"https://www.instagram.com/actual_username/"}
```

```json
{
  "username": "actual_username",
  "name": "Public business name",
  "bio": "Actual public bio",
  "category": "Fashion brand",
  "city": "Москва",
  "country": "Russia",
  "links": [],
  "contacts": [],
  "posts": [
    {
      "caption": "Actual caption",
      "url": "https://www.instagram.com/p/REAL_ID/",
      "publishedAt": "2026-10-01T12:00:00Z",
      "location": "Actual geotag",
      "imageUrl": "https://authorized-public-image.example/image.jpg"
    }
  ]
}
```

Поля опциональны, кроме username. Отсутствие данных не заполняйте догадками. `city` должен отражать опубликованные business/profile сведения, не IP, аудиторию или guess. Картинки передаются внешней vision-модели только когда она настроена. `fetchRecentPosts` HTTP-адаптера использует posts из реально полученного профиля (без подмены пустых публикаций).

## Browser source

`getFollowers` реально открывает `https://www.instagram.com/<handle>/`, кликает доступную ссылку followers, читает profile anchors из dialog, прокручивает доступный контейнер. Cursor содержит уже полученные username, сохраняется в SQLite и не возвращается фронтенду. После рестарта браузер может перечитать видимую часть до новых имён; это не стабильная серверная pagination и не гарантия полноты списка. Проход ограничен 40 прокрутками; длинные/нестабильные списки требуют HTTP provider с cursor pagination.

`fetchProfile` читает доступный header; `fetchRecentPosts` посещает до трёх ссылок из `main`, сохраняет предоставленные страницей caption, canonical post URL и time datetime. Отсутствующие даты не выдумываются. Private/login walls и rate/challenge прекращают доступ. Изменившиеся selectors могут потребовать обновления коннектора; успешный тест DOM-фикстуры не подтверждает актуальную разметку реального Instagram.

Сессия создаётся только оператором через `instagram:login`. Нет чтения cookie основного браузера, хранения пароля в приложении, извлечения чужих токенов, обхода 2FA/CAPTCHA, недокументированных приватных endpoint или stealth-флагов. Playwright browser state остаётся на машине worker. `.authorized` — только локальная отметка успешного входа, не доказательство актуальности cookie; каждый вызов проверяет доступность страницы.

## Task API

Все маршруты используют существующую защиту APP_PASSWORD и проверку Origin при записи.

- `POST /api/agent/tasks` `{prompt,source:"browser"|"http"}` — сохранить новую задачу, вернуть id. Выполнение асинхронное.
- `GET /api/agent/state` — история задач и конфигурационные признаки источников/heartbeat; не проверка live-доступа.
- `GET /api/agent/tasks/:id` — чат, прогресс, вызовы, кандидаты, публичные evidence, delivery status. Без cookie, ключей и discovery cursor.
- `POST /api/agent/tasks/:id/control` `{action:"pause"|"resume"|"stop"}`.
- `POST /api/agent/tasks/:id/chat` `{text}` — поддерживаемые дальнейшие инструкции.
- `POST /api/agent/tasks/:id/approve` `{candidateIds?:string[]}` — отдельное/массовое одобрение доступных draft/approval сообщений. Не запускает очередь автоматически.

## Persistent execution

Состояния задачи: queued, running, paused, stopped, blocked, completed. Необъяснённый сбой инструмента/AI сохраняется как blocked с конкретной ошибкой и инструкцией RESUME. Успешный этап фиксируется транзакционно; завершённые инструменты не повторяются при штатном продолжении. Lease 300 секунд и token защищают от запоздалого результата старого процесса. PAUSE/STOP аннулируют token; незавершённые read-only/AI-вызовы могут быть повторены после RESUME, завершённые данные остаются. После аварии процесс ждёт истечения lease либо оператор нажимает RESUME.

Кандидаты: profile → posts → analysis → draft → selection → queue → done; rejected/error сохраняют причину. Источник аккаунта и provenance фиксируются независимо от общей записи CRM. Недоступный отдельный профиль может быть пропущен; потеря авторизации/ограничение источника останавливает задачу. Ошибки не скрываются успешными fallback-профилями. Перезапуск/RESUME — явная повторная попытка проблемного инструмента; бесконечного автоматического retry нет.

Отбор требует commercial fit, подтверждённой целевой локации и порога scoring из настроек. Локационные citations сверяются с реально полученными текстами; наблюдения публикаций должны быть точной подстрокой существующего evidence. Название города в доставке/хештеге/случайной поездке не является подтверждением бизнес-локации. Unknown остаётся unknown. Стиль и коммерческий потенциал — интерпретации с уверенностью, не факт готовности купить.

Три оффера и независимая оценка вызывают реальные AI adapter stages. Native tool calling не требуется: модель возвращает проверяемый JSON. Оркестратор не исполняет произвольный код модели. Стиль «без вопросов» дополнительно проверяется на `?`; нарушающий ответ не ставится в очередь.

## Delivery boundaries

Browser connector — только исследование. Подготовка и approval отделены от отправки. `sendViaProvider` использует V1 dispatcher с capability check, глобальным интервалом, blacklist/opt-out, одобрением, уникальным lead message и idempotency key. Автосенд возможен только через действительно разрешённого провайдера. При неподдерживаемом Instagram Direct — manual handoff. Неопределённый delivery outcome не повторяется автоматически.

STOP/PAUSE отзывают ещё не выполненные одобрения собственной задачи; dispatcher повторно проверяет состояние связанной задачи перед отправкой. Уже начатый сетевой вызов не отменить. Глобальная очередь в CRM действует независимо; её стоп блокирует все будущие отправки. Оператор по-прежнему может вручную скопировать текст и открыть Instagram вне системы — это не автоматическая отправка и не receipt.

Полноценный Meta OAuth, API универсального списка followers, автоматический браузерный Direct и управление чужой сессией не заявлены как готовые возможности. Несколько worker для HTTP возможны через SQLite leases, но браузерный профиль может принадлежать только одному процессу. Для миграции на PostgreSQL потребуется адаптация persistence/claim слоя; бизнес-правила и tool/source contracts отделены от UI.
