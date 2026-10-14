# Деплой TenderGo: GitHub → VPS

Схема: код лежит в приватном репозитории на GitHub. При каждом пуше в `main` GitHub Actions прогоняет проверки (CI), затем заходит на сервер по SSH и выполняет `git pull` и `docker compose up -d --build`. Первая настройка сервера делается вручную один раз.

## 0. Что понадобится

- Аккаунт на GitHub.
- **VPS в России.** zakupki.gov.ru не отвечает на запросы с зарубежных IP, поэтому загрузка закупок будет работать только с российского сервера. Подойдёт Ubuntu 24.04, 2 ГБ RAM и 20 ГБ диска.
- Домен, у которого A-запись указывает на IP сервера. Её стоит создать заранее: DNS обновляется от нескольких минут до нескольких часов.

## 1. Загрузить код на GitHub

1. Создайте **пустой приватный** репозиторий на https://github.com/new. Галочки README, .gitignore и license не ставьте.
2. В терминале на Mac:
   ```bash
   cd ~/Documents/Разработка/tendergo
   git add .
   git status            # в списке не должно быть .env и node_modules
   git commit -m "TenderGo: первая версия"
   git remote add origin git@github.com:ВАШ_ЛОГИН/tendergo.git
   git push -u origin main
   ```
   Если `git push` пишет `Permission denied (publickey)`, на Mac нет SSH-ключа для GitHub. Создайте его и добавьте в профиль:
   ```bash
   ssh-keygen -t ed25519 -C "ваш@email"   # на все вопросы можно нажать Enter
   cat ~/.ssh/id_ed25519.pub              # скопируйте вывод
   ```
   Добавьте скопированное в GitHub → Settings → SSH and GPG keys → New SSH key и повторите `git push -u origin main`.
3. Откройте вкладку **Actions** в репозитории. Проверка CI должна стать зелёной примерно за 3–5 минут: проверка типов, тесты на PostgreSQL 17, сборка фронтенда и Docker-образов. Workflow **Deploy** пока пропустит деплой: секреты для сервера ещё не заданы, это нормально.

## 2. Подготовить сервер (один раз)

Подключитесь к серверу под root (IP и пароль даёт хостинг):

```bash
ssh root@IP_СЕРВЕРА
```

Создайте пользователя, установите Docker и откройте порты:

```bash
adduser deploy                      # задайте пароль, остальные вопросы — Enter
apt update && apt install -y docker.io docker-compose-v2 git
usermod -aG docker deploy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
docker compose version              # должна вывестись версия v2.x
```

Если у сервера 1 ГБ RAM, добавьте swap, иначе сборка может упасть по нехватке памяти:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 3. Дать серверу доступ к репозиторию

Репозиторий приватный, поэтому серверу нужен ключ только на чтение (deploy key):

```bash
su - deploy
ssh-keygen -t ed25519 -f ~/.ssh/github -N ""
cat ~/.ssh/github.pub               # скопируйте вывод
```

На GitHub откройте репозиторий → Settings → Deploy keys → Add deploy key. Вставьте ключ, галочку «Allow write access» **не** ставьте. Затем на сервере:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:ВАШ_ЛОГИН/tendergo.git ~/tendergo
```

На вопрос `Are you sure you want to continue connecting` ответьте `yes`.

## 4. Настроить и запустить

Всё ещё под пользователем `deploy`:

```bash
cd ~/tendergo
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/; s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
chmod 600 .env
nano .env                           # впишите свой домен в DOMAIN=, сохраните: Ctrl+O, Enter, Ctrl+X
docker compose up -d --build        # первая сборка занимает 3–10 минут
docker compose ps                   # db, api, worker, web должны быть в статусе running / healthy
```

Откройте `https://ваш-домен` и зарегистрируйтесь. Первый пользователь становится владельцем своей организации.

Проверьте загрузку закупок:

```bash
docker compose logs -f worker       # выход — Ctrl+C
```

Нормальная работа выглядит так:

```
eis: page 1: 50 cards, 50 new or changed
eis: page 2: 50 cards, 50 new or changed
...
ingest: ok, fetched=2000 upserted=2000 purged=0
```

Первый проход долгий, примерно 1–2 часа: для каждой закупки открывается страница извещения. Закупки появляются на сайте постепенно, по мере загрузки. Следующие проходы запускаются каждый час и обрабатывают только новые и изменённые закупки.

Если в логе `page 1: 0 cards` или ошибки `HTTP 403` / `fetch failed` при обращении к zakupki.gov.ru:

- проверьте, что ЕИС открывается с сервера: `curl -sI https://zakupki.gov.ru | head -1`;
- если открывается, но карточек 0, значит, ЕИС поменял вёрстку. Сохраните страницу командой `curl -s "https://zakupki.gov.ru/epz/order/extendedsearch/results.html?fz44=on&fz223=on&af=on" > page.html` и пришлите её вместе с логом — парсер правится в одном файле.

## 5. Автодеплой из GitHub

Создайте отдельный ключ, которым GitHub Actions будет заходить на сервер. Выполните на Mac:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tendergo_actions -N "" -C "github-actions"
ssh-copy-id -i ~/.ssh/tendergo_actions.pub deploy@IP_СЕРВЕРА    # введите пароль пользователя deploy
cat ~/.ssh/tendergo_actions                                      # приватный ключ — для секрета ниже
```

Если `ssh-copy-id` не пускает (хостинг отключил вход по паролю), добавьте ключ вручную. Скопируйте вывод `cat ~/.ssh/tendergo_actions.pub` на Mac и выполните на сервере под `deploy`:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ВСТАВЬТЕ_СЮДА_ПУБЛИЧНЫЙ_КЛЮЧ' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

В репозитории на GitHub откройте Settings → Secrets and variables → Actions → New repository secret и добавьте:

| Секрет | Значение |
|---|---|
| `VPS_HOST` | IP сервера |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | весь вывод `cat ~/.ssh/tendergo_actions`, включая строки `BEGIN` и `END` |
| `VPS_PORT` | только если SSH работает не на порту 22 |

Готово. Теперь каждый `git push` в `main` запускает CI, а после успешной проверки — Deploy. Задеплоить вручную можно так: Actions → Deploy → Run workflow. Если CI упал, деплой не запускается, и на сервере остаётся рабочая версия.

## 6. Обслуживание

```bash
cd ~/tendergo
docker compose logs -f api              # логи сайта
docker compose logs -f worker           # логи загрузки из ЕИС
docker compose restart worker           # перезапустить загрузку
nano .env && docker compose up -d       # поменять настройки
git pull && docker compose up -d --build   # ручное обновление без GitHub Actions
```

**Резервные копии.** Ежедневный бэкап в 03:00, хранятся 14 последних (`crontab -e` под пользователем `deploy`):

```
0 3 * * * mkdir -p ~/backups && cd ~/tendergo && docker compose exec -T db pg_dump -U tendergo tendergo | gzip > ~/backups/tendergo-$(date +\%F).sql.gz && ls -t ~/backups/*.sql.gz | tail -n +15 | xargs -r rm
```

Восстановление из копии:

```bash
gunzip -c ~/backups/tendergo-2026-10-14.sql.gz | docker compose exec -T db psql -U tendergo tendergo
```

Бэкапы лежат на том же сервере, поэтому время от времени копируйте их к себе: `scp deploy@IP_СЕРВЕРА:~/backups/* .`

## Если что-то пошло не так

| Симптом | Что делать |
|---|---|
| `docker compose up` падает на скачивании образов (403, timeout) | Docker Hub может быть недоступен из РФ. Создайте `/etc/docker/daemon.json` с содержимым `{"registry-mirrors": ["https://mirror.gcr.io"]}` (или зеркалом вашего хостинга), выполните `sudo systemctl restart docker` и повторите. |
| Сайт не открывается по HTTPS | Проверьте A-запись (`ping ваш-домен` должен показать IP сервера), открытые порты 80/443 и `docker compose logs web` — там видно, почему не выпустился сертификат. |
| `JWT_SECRET must be set in production` или ошибка про JWT_SECRET в логах api | В `.env` пустой или короткий `JWT_SECRET`, повторите команду `sed` из шага 4. |
| Deploy в Actions падает на `ssh` | Проверьте секреты; что публичный ключ попал в `~/.ssh/authorized_keys` пользователя `deploy`; что SSH-порт доступен из интернета. |
| Deploy падает на `git pull` | На сервере кто-то менял файлы в `~/tendergo`. Посмотрите `git status` и верните изменения: `git checkout -- .` (файл `.env` не затрагивается). |
| Сборка падает с `Killed` / нехватка памяти | Добавьте swap (шаг 2). |
