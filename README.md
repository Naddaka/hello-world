# GenHub

Личный агрегатор нейрогенерации видео и изображений. Запросы идут напрямую в API провайдеров (BytePlus ModelArk для Seedance, fal.ai для остальных моделей), а стоимость каждой генерации видна сразу.

Пользователь один, вход по одному паролю.

## Стек

- Next.js 16 (App Router) + TypeScript, Tailwind
- SQLite (better-sqlite3) + Drizzle ORM, миграции в `drizzle/`
- Файлы результатов на локальном диске в `DATA_DIR`
- Фоновая обработка задач в том же процессе (появится на этапе 2)

## Быстрый старт

Нужен Node.js 22+.

```bash
npm install
cp .env.example .env      # задайте APP_PASSWORD
npm run dev               # http://localhost:3000
```

Миграции применяются автоматически при старте сервера. Применить их вручную:

```bash
npm run db:migrate
```

Продакшен-сборка локально:

```bash
npm run build
npm start
```

> При `npm start` (`NODE_ENV=production`) cookie сессии ставится с флагом `Secure`. На `localhost` браузеры это допускают. Если открываете сервер по голому `http://IP`, задайте `COOKIE_SECURE=false`. За Caddy с HTTPS (этап 7) ничего менять не нужно.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `APP_PASSWORD` | Пароль входа. Без него вход невозможен. |
| `SESSION_SECRET` | Ключ подписи cookie. Если пусто, выводится из пароля, поэтому смена пароля разлогинивает все сессии. |
| `DATA_DIR` | Каталог для БД (`app.db`) и файлов результатов. По умолчанию `./data`. |
| `PROVIDER_MODE` | `mock` (без сети, тестовые результаты) или `real`. |
| `FAL_KEY`, `BYTEPLUS_API_KEY` | Ключи провайдеров, нужны только в режиме `real`. |
| `APP_TIMEZONE` | Часовой пояс для границ месяца в расходах. По умолчанию `Europe/Kyiv`. |
| `MONTHLY_BUDGET_USD` | Месячный лимит расходов. Пусто означает без лимита. |

Секреты хранятся только в `.env`, а он в `.gitignore`.

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | dev-сервер |
| `npm run build` / `npm start` | сборка и запуск |
| `npm test` | юнит-тесты (Vitest) |
| `npm run lint` | проверка типов |
| `npm run db:generate` | создать миграцию после изменения `src/db/schema.ts` |
| `npm run db:migrate` | применить миграции |

## Структура

```
src/
  app/            страницы и API (App Router)
  db/             схема Drizzle и подключение к SQLite
  lib/            конфиг, авторизация
  proxy.ts        проверка сессии на каждом запросе (в Next 16 бывший middleware)
  instrumentation.ts  код при старте сервера: миграции, позже фоновый цикл
drizzle/          SQL-миграции
tests/            тесты
```
