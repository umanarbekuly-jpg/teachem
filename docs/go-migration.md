# Перенос серверной части TeachEm на Go

Исходная версия: `cc1810b` (рабочее дерево чистое перед переносом).

Перенос реализован: независимый сервер Go находится в `apps/api-go`, коммит реализации — `4be9f8d`. Сохраняются существующий frontend, 78 доменных маршрутов и два health-маршрута, формат REST-ответов, авторизация и данные. TypeScript backend удаляется из текущей сборки; его исходники доступны в истории Git. Итоговую проверку конкретного локального развёртывания следует фиксировать отдельно от результатов изолированных тестов ниже.

## Карта существующего API

Имена обработчиков в правом столбце — исходные operationId контракта; это не названия функций Go. OpenAPI сохранён в `apps/api-go/contracts/openapi.json` и доступен по `/api/openapi.json`; `/api/docs` показывает Swagger.

| Метод | Маршрут | Обработчик |
|---|---|---|
| GET | `/health/live` | `Health_live` |
| GET | `/health/ready` | `Health_ready` |
| GET | `/api/v1/auth/csrf` | `Auth_csrf` |
| POST | `/api/v1/auth/register` | `Auth_register` |
| POST | `/api/v1/auth/login` | `Auth_login` |
| POST | `/api/v1/auth/refresh` | `Auth_refresh` |
| POST | `/api/v1/auth/change-password` | `Auth_changePassword` |
| POST | `/api/v1/auth/logout` | `Auth_logout` |
| GET | `/api/v1/auth/me` | `Auth_me` |
| GET | `/api/v1/users/me` | `Users_me` |
| PATCH | `/api/v1/users/me` | `Users_update` |
| GET | `/api/v1/tutors/me/profile` | `Tutors_mine` |
| PATCH | `/api/v1/tutors/me/profile` | `Tutors_update` |
| GET | `/api/v1/tutors` | `Tutors_list` |
| GET | `/api/v1/tutors/{id}` | `Tutors_get` |
| GET | `/api/v1/admin/courses` | `Courses_all` |
| GET | `/api/v1/courses` | `Courses_list` |
| POST | `/api/v1/courses` | `Courses_create` |
| GET | `/api/v1/tutors/me/courses` | `Courses_mine` |
| GET | `/api/v1/courses/subjects` | `Courses_subjects` |
| GET | `/api/v1/courses/{id}/edit` | `Courses_edit` |
| GET | `/api/v1/courses/{id}` | `Courses_get` |
| PATCH | `/api/v1/courses/{id}` | `Courses_update` |
| DELETE | `/api/v1/courses/{id}` | `Courses_remove` |
| POST | `/api/v1/courses/{id}/publish` | `Courses_publish` |
| POST | `/api/v1/courses/{id}/archive` | `Courses_archive` |
| POST | `/api/v1/files/uploads` | `Files_upload` |
| POST | `/api/v1/files/{id}/complete` | `Files_complete` |
| GET | `/api/v1/files/{id}/download` | `Files_download` |
| GET | `/api/v1/learning/courses/{id}` | `Enrollments_learning` |
| POST | `/api/v1/courses/{id}/enrollments` | `Enrollments_enroll` |
| GET | `/api/v1/courses/{id}/enrollments` | `Enrollments_students` |
| GET | `/api/v1/enrollments/me` | `Enrollments_mine` |
| GET | `/api/v1/tutors/me/students` | `Enrollments_allStudents` |
| GET | `/api/v1/courses/{id}/materials` | `Materials_list` |
| POST | `/api/v1/courses/{id}/materials` | `Materials_create` |
| PATCH | `/api/v1/materials/{id}` | `Materials_update` |
| DELETE | `/api/v1/materials/{id}` | `Materials_remove` |
| POST | `/api/v1/enrollments/{id}/payments` | `Payments_create` |
| GET | `/api/v1/payments/me` | `Payments_mine` |
| GET | `/api/v1/payments/{id}` | `Payments_get` |
| GET | `/api/v1/payments/{id}/instructions` | `Payments_instructions` |
| POST | `/api/v1/payments/{id}/submit` | `Payments_submit` |
| GET | `/api/v1/tutors/me/finances` | `Payouts_finance` |
| GET | `/api/v1/tutors/me/payouts` | `Payouts_list` |
| GET | `/api/v1/courses/{id}/tests` | `Tests_list` |
| POST | `/api/v1/courses/{id}/tests` | `Tests_create` |
| GET | `/api/v1/tests/{id}` | `Tests_get` |
| PATCH | `/api/v1/tests/{id}` | `Tests_update` |
| DELETE | `/api/v1/tests/{id}` | `Tests_remove` |
| POST | `/api/v1/tests/{id}/publish` | `Tests_publish` |
| POST | `/api/v1/tests/{id}/copy` | `Tests_copy` |
| POST | `/api/v1/tests/{id}/attempts` | `Tests_start` |
| GET | `/api/v1/tests/{id}/attempts` | `Tests_attempts` |
| GET | `/api/v1/test-attempts/me` | `Tests_mine` |
| GET | `/api/v1/test-attempts/{id}` | `Tests_attempt` |
| PUT | `/api/v1/test-attempts/{id}/answers` | `Tests_save` |
| POST | `/api/v1/test-attempts/{id}/submit` | `Tests_submit` |
| GET | `/api/v1/sessions/me` | `Sessions_mine` |
| GET | `/api/v1/courses/{id}/sessions` | `Sessions_list` |
| POST | `/api/v1/courses/{id}/sessions` | `Sessions_create` |
| PATCH | `/api/v1/sessions/{id}` | `Sessions_update` |
| POST | `/api/v1/sessions/{id}/cancel` | `Sessions_cancel` |
| GET | `/api/v1/sessions/{id}/join` | `Sessions_join` |
| POST | `/api/v1/admin/users/{id}/block` | `Admin_block` |
| POST | `/api/v1/admin/users/{id}/unblock` | `Admin_unblock` |
| GET | `/api/v1/admin/payments` | `Admin_listPayments` |
| POST | `/api/v1/admin/payments/{id}/approve` | `Admin_approve` |
| POST | `/api/v1/admin/payments/{id}/reject` | `Admin_reject` |
| GET | `/api/v1/admin/payouts` | `Admin_listPayouts` |
| POST | `/api/v1/admin/payouts/{id}/mark-paid` | `Admin_paid` |
| GET | `/api/v1/admin/settings` | `Admin_getSettings` |
| PATCH | `/api/v1/admin/settings` | `Admin_updateSettings` |
| GET | `/api/v1/admin/audit-logs` | `Admin_logs` |
| GET | `/api/v1/admin/users` | `UserManagement_list` |
| POST | `/api/v1/admin/users` | `UserManagement_create` |
| GET | `/api/v1/admin/users/{id}` | `UserManagement_get` |
| PATCH | `/api/v1/admin/users/{id}` | `UserManagement_update` |
| POST | `/api/v1/admin/users/{id}/role` | `UserManagement_role` |
| POST | `/api/v1/admin/users/{id}/password` | `UserManagement_reset` |

## Инфраструктура исходной версии

- NestJS REST API; PostgreSQL 16 с четырьмя SQL-миграциями Prisma; MinIO с закрытым bucket и presigned POST/GET.
- JWT HS256 в httpOnly cookies, серверная таблица AuthSession, bcrypt (cost 12), CSRF double-submit + проверка Origin.
- Next.js остаётся отдельным TypeScript-приложением. Прямого доступа фронтенда к БД и бизнес-логики в server actions/API routes не обнаружено.
- Платежи ручные: реквизиты, чек, подтверждение суперадмином, начисление выплаты. Видео — ссылка встречи. Уведомления отключены; планировщика и фонового воркера нет.
- Существующие ограничения единственного SUPERADMIN и снимки длительности покупок остаются в той же базе.

## Текущая структура

- `cmd/server` — независимый Go-процесс с командами `serve`, `migrate`, `seed`, `healthcheck`.
- `internal/core` — HTTP, конфигурация, ошибки, CSRF/Origin, ограничение запросов, PostgreSQL через pgx и сериализуемые транзакции.
- `internal/accounts` — авторизация, пользователи, личный профиль, управление пользователями и тьюторы.
- `internal/learning` — каталог, курсы, записи, материалы, встречи, тесты и попытки.
- `internal/commerce` — файлы, платежи, начисления, выплаты, настройки, блокировки и аудит.
- `internal/storage` — MinIO/S3; `internal/migrate` — миграции и seed.

Модули регистрируют свои маршруты с общей серверной проверкой ролей. Правила владельца курса и оплаченного доступа переиспользуются между модулями. Входные данные проверяются до записи; SQL вынесен в репозитории, критические операции выполняются транзакционно. Для новых функций развивайте соответствующий модуль, обновляйте OpenAPI и сгенерированный клиент, добавляйте проверки поведения и доступа. Дополнительный слой или отдельный сервис нужны только при конкретной необходимости.

Frontend остаётся на Next.js/TypeScript. Общий REST-клиент и отдельный клиент управления пользователями используют одну конфигурацию адреса API. При разработке Next.js перенаправляет `/api/*` на Go-сервер; Node.js не нужен для работы самого API.

## База и обратная совместимость

Перенос языка **не добавляет новую миграцию схемы**. Четыре первоначальных SQL-файла находятся в `apps/api-go/internal/migrate/sql`:

1. `202610180001_initial.sql`;
2. `202610180002_constraints.sql`;
3. `202610200001_superadmin.sql`;
4. `202610220001_course_options.sql`.

Их содержание сохранено; Go-runner использует существующую таблицу `_prisma_migrations`, имена миграций и SHA-256. Контрольная сумма учитывает эквивалентное представление переводов строк LF/CRLF. Уже завершённые миграции не повторяются; несовпадение содержания или незавершённая запись требуют разбора. Одновременные запуски защищены advisory lock, каждая новая миграция и запись журнала фиксируются одной транзакцией.

Существующие ID, bcrypt-хеши, роли, данные профилей, курсы, платежи, длительность приобретённого доступа, серверные сессии и ключи S3 не преобразуются. Для совместимости нужны прежние JWT-секреты, подключение к той же БД и тому же bucket. Seed ищет владельца по SUPERADMIN и добавляет только отсутствующие начальные настройки; он не возвращает старый пароль при перезапуске.

Для будущего изменения схемы добавьте новый SQL-файл с сортируемым уникальным именем, проверьте чистую установку и обновление копии БД. Не редактируйте применённые миграции и не очищайте журнал. Перед потенциально разрушительными изменениями нужны свежая копия и проверенный план восстановления; откат кода не заменяет восстановление данных.

## Независимый запуск

Полная инструкция находится в [README](../README.md). Compose собирает Go API из `apps/api-go/Dockerfile`; сервисы `migrate` и `seed` используют тот же бинарный файл. Существующий `scripts/start-local.ps1` пересобирает платформу и открывает http://localhost:8080/login.

Для запуска из исходников задайте переменные окружения по `apps/api-go/.env.example` и выполните из корня:

```sh
go -C apps/api-go run ./cmd/server migrate
go -C apps/api-go run ./cmd/server seed
go -C apps/api-go run ./cmd/server
```

API не читает `.env` автоматически. Windows-помощник `scripts/start-api.ps1` читает корневой `.env` и подставляет локальные адреса PostgreSQL/MinIO, порт API 4000 и origin `http://localhost:3000`. Frontend запускается отдельно через `pnpm dev`. Для загрузок MinIO CORS тоже должен разрешать этот origin. В Docker адрес сайта по умолчанию — `http://localhost:8080`.

## Выполненные проверки реализации

- Модульные проверки Go для core, accounts, learning, commerce и storage; `go vet`.
- HTTP-наборы авторизации, личного профиля и управления пользователями, курсов/материалов/занятий/тестов, файлов/платежей/выплат на отдельной PostgreSQL-базе. Проверены отказы по ролям и чужим ID, CSRF, отзыв сессий, обязательная смена пароля, защита SUPERADMIN, снимки условий покупок и конкурентное подтверждение оплаты.
- Проверки на изолированной копии существующей БД, включая сохранение состояния после повторного создания Go-приложения.
- Совместимость JWT и bcrypt в обе стороны: старый сервер → Go и Go → старый сервер.
- Чистая установка всех четырёх миграций и повторный seed без перезаписи существующих данных.
- Настоящий MinIO в собственном временном bucket: presigned POST, проверка метаданных/размера, запись готового объекта и подписанное скачивание.
- Production-сборки Docker API и web.

Запуск: `pnpm test` для Go-набора; `pnpm test:e2e` требует `TEACHEM_TEST_DATABASE_URL` с `test` в имени базы. Сначала примените миграции, задав `DATABASE_URL` на ту же изолированную базу. Пакеты запускаются последовательно (`-p 1`), так как несколько HTTP-наборов используют единственного тестового владельца. Без тестовой БД соответствующие Go-тесты пропускаются; команда `test:e2e` вместо молчаливого пропуска завершится ошибкой конфигурации.

Реальный S3-набор требует `TEACHEM_TEST_S3_ENDPOINT` с локальным endpoint, `TEACHEM_TEST_S3_ACCESS_KEY` и `TEACHEM_TEST_S3_SECRET_KEY`. Без них проверка MinIO явно пропускается; остальные HTTP-тесты используют хранилище в памяти. CI поднимает тестовый PostgreSQL; внешний MinIO в стандартный CI-набор не включён.

Не заявляются новые внешние интеграции: подтверждение email, восстановление пароля, автоматическая оплата, доставка уведомлений и создание Meet по API отсутствовали и остаются вне MVP.

### Проверка локального переключения — 30 октября 2026

Штатный Compose успешно запущен с Go API (`/server serve`); health проверяет PostgreSQL и MinIO. TypeScript API удалён из текущих исходников и сборки. Временные контейнеры сравнения старого и нового серверов остановлены и удалены.

До переключения сохранён дамп `../../work/backups/teachem-before-go-20261030.dump` вне Git; восстановление проверено в отдельной базе `teachem_go_test`. Сравнение количества строк и контрольных сумм содержимого всех 20 таблиц до и после запуска Go подтвердило полное совпадение, включая пользователей, сессии, покупки и журнал миграций. Отдельное такое же сравнение пройдено после повторного запуска; рабочие данные не очищались.

В браузере проверены вход существующего SUPERADMIN с прежним паролем, панель пользователей, личный профиль, каталог, фильтр по тегу, страница курса с прежней обложкой из MinIO и загрузка текущих значений в редакторе курса. После перезапуска API текущая сессия сохранила доступ. Изменяющие данные сценарии всех ролей проверялись HTTP-тестами на отдельной базе; повторно через браузер они не выполнялись на рабочей базе.

Все 28 функций Go-тестов, включая HTTP/PostgreSQL и настоящий MinIO, выполнены без пропусков в подготовленном окружении. Проверены `go vet`, TypeScript, ESLint, генерация клиента, сборки Docker API/web, чистая установка и повторный seed. GitHub Actions настроен, но удалённый CI в рамках этой локальной проверки не запускался.

## Откат переключения на Go

Откатывайте **коммит переключения запуска** с сообщением `build: switch default runtime to Go and retire TypeScript API`: он удаляет TypeScript backend и меняет Compose, команды и конфигурацию frontend. Его хеш можно найти через `git log --oneline --grep="build: switch default runtime to Go"`; он также указан в итоговом отчёте. Коммит реализации Go `4be9f8d` сам по себе не переключает запуск; удалять Go-код для возврата старого сервера не требуется.

1. Проверьте Git и сохраните незавершённую работу. Сохраните свежий дамп для страховки; не удаляйте PostgreSQL/MinIO volumes.
2. Остановите приложения: `docker compose stop gateway web api`.
3. Выполните `git revert <коммит-переключения-на-Go>`. Это вернёт TypeScript backend и прежнюю конфигурацию запуска согласованно.
4. Выполните `docker compose up -d --build --wait`, сохранив текущий `.env`, JWT-секреты, БД и файлы.
5. Проверьте готовность, вход, профиль, каталог, доступ к курсу и административную панель.

**Для этого отката не восстанавливайте старый дамп:** схема и форматы совместимы, а восстановление старой копии потеряет новые действия пользователей. Журнал `_prisma_migrations` остаётся общим, поэтому старый runner увидит ранее применённые миграции. Этот способ относится к данному переносу; будущие изменения схемы требуют отдельной оценки совместимости.

Исторические инструкции отмены функций SUPERADMIN, профиля и параметров курсов описывают другие изменения. Их миграции и ограничения не нужно отменять при возврате с Go на предыдущий TypeScript backend.
