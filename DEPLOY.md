# Деплой TenderGo: GitHub → сервер itb2bhost.ru

Сайт открывается по адресу **https://itb2bhost.ru/tendergo**.

На сервере itb2bhost.ru уже работают nginx и другой сайт. TenderGo ставится рядом в Docker и этот сайт не трогает:

- Контейнеры TenderGo слушают только локальный порт `127.0.0.1:8090`, снаружи он не виден. Порты 80/443 и HTTPS-сертификат остаются за вашим nginx.
- В конфигурацию nginx добавляется один блок, который отправляет в TenderGo только адреса, начинающиеся с `/tendergo`. Всё остальное по-прежнему уходит вашему сайту.

Код хранится в репозитории на GitHub. Каждый пуш в `main` проходит проверки (CI), после чего GitHub Actions заходит на сервер и обновляет TenderGo. Первая настройка делается вручную один раз.

## 0. Что понадобится

- Аккаунт на GitHub.
- SSH-доступ к серверу itb2bhost.ru с правами `sudo`. На сервере нужно минимум 2 ГБ памяти, в том числе с учётом swap.
- **Сервер в России.** zakupki.gov.ru не отвечает зарубежным IP, поэтому загрузка закупок работает только с российского сервера.

## 1. Отправить код на GitHub

Репозиторий: https://github.com/q100mhz/tendergo (уже создан, первый коммит отправлен). Изменения отправляются так:

```bash
cd ~/Documents/Разработка/tendergo
git add .
git status            # в списке не должно быть .env и node_modules
git commit -m "Описание изменений"
git push
```

Репозиторий сейчас публичный. Секретов в нём нет: пароли лежат только в `.env` на сервере. Если не хотите, чтобы код был виден всем, сделайте его приватным (Settings → General → Danger Zone → Change visibility). Тогда серверу понадобится ключ доступа, см. шаг 3.

После каждого `git push` откройте вкладку **Actions** в репозитории: проверка CI должна стать зелёной примерно за 3–5 минут. Пока секреты для сервера не заданы (шаг 6), workflow **Deploy** пропускает деплой — это нормально.

## 2. Подготовить сервер (один раз)

Подключитесь к серверу:

```bash
ssh root@itb2bhost.ru     # или ваш пользователь с sudo
```

Проверьте, установлен ли Docker:

```bash
docker compose version
```

- Выводит версию `v2.x` — пропустите установку.
- `command not found` — установите Docker из репозитория Ubuntu:
  ```bash
  sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
  ```

Создайте отдельного пользователя для TenderGo и дайте ему доступ к Docker:

```bash
sudo adduser deploy                 # задайте пароль, остальные вопросы — Enter
sudo usermod -aG docker deploy
```

Проверьте, что порт 8090 свободен:

```bash
ss -ltn | grep ':8090 ' || echo "порт свободен"
```

Если порт занят, выберите другой, например 8091. Его нужно будет указать в `.env` (`WEB_PORT`) и в блоке nginx (шаг 5).

Если памяти меньше 2 ГБ, добавьте swap, иначе сборка может упасть:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Файрвол менять не нужно: TenderGo не открывает наружу новых портов.

## 3. Скачать код на сервер

Пока репозиторий публичный, достаточно склонировать его под пользователем `deploy`:

```bash
sudo su - deploy
git clone https://github.com/q100mhz/tendergo.git ~/tendergo
```

Если вы сделали репозиторий приватным, серверу нужен ключ только на чтение (deploy key):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github -N ""
cat ~/.ssh/github.pub               # скопируйте вывод
```

На GitHub откройте репозиторий → Settings → Deploy keys → Add deploy key. Вставьте ключ, галочку «Allow write access» **не** ставьте. Затем на сервере:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github\n  IdentitiesOnly yes\n' >> ~/.ssh/config
git clone git@github.com:q100mhz/tendergo.git ~/tendergo
```

На вопрос `Are you sure you want to continue connecting` ответьте `yes`. Если репозиторий уже был склонирован по HTTPS, переключите адрес: `git -C ~/tendergo remote set-url origin git@github.com:q100mhz/tendergo.git`.

## 4. Настроить и запустить TenderGo

Под пользователем `deploy`:

```bash
cd ~/tendergo
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/; s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
chmod 600 .env
```

В `.env` уже прописаны `DOMAIN=itb2bhost.ru`, `BASE_PATH=/tendergo` и `WEB_PORT=8090`. Менять их нужно, только если на шаге 2 порт 8090 оказался занят. Запуск:

```bash
docker compose up -d --build                      # первая сборка занимает 3–10 минут
docker compose ps                                 # db, api, worker, web — running / healthy
curl -sI http://127.0.0.1:8090/tendergo/ | head -1   # должно быть HTTP/1.1 200 OK
```

## 5. Подключить TenderGo к nginx

Найдите файл конфигурации сайта itb2bhost.ru:

```bash
sudo grep -rln "itb2bhost.ru" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
```

Откройте найденный файл (`sudo nano путь/к/файлу`). Найдите блок `server { ... }`, в котором есть `server_name itb2bhost.ru` и `listen 443 ssl`. Вставьте внутрь него, например прямо перед строкой `location / {`, этот блок (он же лежит в репозитории: `deploy/nginx-tendergo.conf`):

```nginx
location ^~ /tendergo {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 1m;
}
```

Если на шаге 2 вы выбрали другой порт, поменяйте `8090` и здесь. Затем проверьте конфигурацию и примените её:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Откройте **https://itb2bhost.ru/tendergo** и зарегистрируйтесь. Первый пользователь становится владельцем своей организации. Убедитесь, что основной сайт на `https://itb2bhost.ru/` работает как раньше.

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

Первый проход долгий, примерно 1–2 часа: для каждой закупки открывается страница извещения. Закупки появляются на сайте постепенно. Следующие проходы запускаются каждый час и обрабатывают только новые и изменённые закупки.

Если в логе `page 1: 0 cards` или ошибки `HTTP 403` / `fetch failed` при обращении к zakupki.gov.ru:

- проверьте, что ЕИС открывается с сервера: `curl -sI https://zakupki.gov.ru | head -1`;
- если открывается, но карточек 0, значит, ЕИС поменял вёрстку. Сохраните страницу командой `curl -s "https://zakupki.gov.ru/epz/order/extendedsearch/results.html?fz44=on&fz223=on&af=on" > page.html` и пришлите её вместе с логом — парсер правится в одном файле.

## 6. Автодеплой из GitHub

Создайте отдельный ключ, которым GitHub Actions будет заходить на сервер. Выполните на Mac:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/tendergo_actions -N "" -C "github-actions"
ssh-copy-id -i ~/.ssh/tendergo_actions.pub deploy@itb2bhost.ru   # введите пароль пользователя deploy
cat ~/.ssh/tendergo_actions                                      # приватный ключ — для секрета ниже
```

Если `ssh-copy-id` не пускает (на сервере отключён вход по паролю), добавьте ключ вручную. Скопируйте вывод `cat ~/.ssh/tendergo_actions.pub` на Mac и выполните на сервере под `deploy`:

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ВСТАВЬТЕ_СЮДА_ПУБЛИЧНЫЙ_КЛЮЧ' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

В репозитории на GitHub откройте Settings → Secrets and variables → Actions → New repository secret и добавьте:

| Секрет | Значение |
|---|---|
| `VPS_HOST` | `itb2bhost.ru` (или IP сервера) |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | весь вывод `cat ~/.ssh/tendergo_actions`, включая строки `BEGIN` и `END` |
| `VPS_PORT` | только если SSH работает не на порту 22 |

Готово. Теперь каждый `git push` в `main` запускает CI, а после успешной проверки — Deploy. Задеплоить вручную можно так: Actions → Deploy → Run workflow. Если CI упал, деплой не запускается, и на сервере остаётся рабочая версия. Конфигурацию nginx автодеплой не меняет: её настраивают один раз на шаге 5.

## 7. Обслуживание

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

Бэкапы лежат на том же сервере, поэтому время от времени копируйте их к себе: `scp deploy@itb2bhost.ru:~/backups/* .`

## Если что-то пошло не так

| Симптом | Что делать |
|---|---|
| `Cannot GET /tendergo` | Запрос уходит вашему основному сайту, а не в TenderGo. Блок `location ^~ /tendergo` не добавлен, добавлен не в тот `server` (нужен тот, где `listen 443 ssl` и `server_name itb2bhost.ru`) или nginx не перезагружен (`sudo nginx -t && sudo systemctl reload nginx`). |
| `502 Bad Gateway` на /tendergo | nginx не достучался до TenderGo. Проверьте `docker compose ps` и `curl -sI http://127.0.0.1:8090/tendergo/`, а также совпадение порта в `.env` (`WEB_PORT`) и в блоке nginx. |
| Страница пустая или без оформления | Путь в `.env` должен быть ровно `BASE_PATH=/tendergo`. После исправления пересоберите: `docker compose up -d --build`. |
| После входа снова выбрасывает на страницу входа | Сайт открыт по `http://`, а cookie входа работает только по HTTPS. Откройте `https://itb2bhost.ru/tendergo`. |
| `docker compose up` падает на скачивании образов (403, timeout) | Docker Hub может быть недоступен из РФ. Создайте `/etc/docker/daemon.json` с содержимым `{"registry-mirrors": ["https://mirror.gcr.io"]}` (или зеркалом вашего хостинга), выполните `sudo systemctl restart docker` и повторите. |
| Ошибка про `JWT_SECRET` в логах api | В `.env` пустой или короткий `JWT_SECRET`. Повторите команду `sed` из шага 4. |
| Deploy в Actions падает на `ssh` | Проверьте секреты; что публичный ключ попал в `~/.ssh/authorized_keys` пользователя `deploy`; что SSH-порт доступен из интернета. |
| Deploy падает на `git pull` | На сервере кто-то менял файлы в `~/tendergo`. Посмотрите `git status` и верните изменения: `git checkout -- .` (файл `.env` не затрагивается). |
| Сборка падает с `Killed` / нехватка памяти | Добавьте swap (шаг 2). |
