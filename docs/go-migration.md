# Перенос серверной части TeachEm на Go

Исходная версия: `cc1810b` (рабочее дерево чистое перед переносом).

## Карта существующего API

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

## Порядок проверки

1. Сохранить контрольную точку и резервную копию; проверить восстановление отдельно.
2. Реализовать независимый Go API с прежним контрактом и совместимой авторизацией.
3. Проверить старый и новый сервер на изолированных данных; проверить frontend и Compose.
4. Только после проверки переключить рабочий запуск. До этого используется исходный сервер.

Статус: перенос выполняется. Этот документ не подтверждает завершение миграции.
