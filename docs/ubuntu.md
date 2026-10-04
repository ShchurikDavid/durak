# Развёртывание на MVPS / Ubuntu

## Текущее развёртывание — 4 октября 2026

Игра запущена на MVPS VPS-156376, IP `85.137.173.104`, Ubuntu 26.04 LTS.
Адрес: https://game.durakcards.uk. Node.js 24.21.0, один процесс игры.
Активный релиз: `/opt/durak/releases/3.231-security`, ссылка `/opt/durak/current`.
Службы `durak` и `cloudflared` включены в автозапуск systemd.

Используется существующий Cloudflare Tunnel, перенесённый с Windows на VPS.
DNS менять не потребовалось. Nginx установлен, но отключён: туннель обращается
непосредственно к `127.0.0.1:3000`. Порт игры не слушает внешний интерфейс.
Ключ туннеля находится в `/etc/cloudflared` (каталог 700, ключ 600),
конфигурация игры — `/etc/durak.env` (600), база — `/var/lib/durak/durak.sqlite`
(600, владелец durak). Ключи и база не включены в публичную папку сайта.

Согласованная копия SQLite перенесена через SSH: 2 аккаунта и 1 запись истории.
Исходная база на компьютере сохранена. Не запускайте старый Windows-туннель:
иначе Cloudflare сможет направлять часть клиентов на старый сервер.

Проверены внешний HTTPS health-check, Secure cookie, закрытый доступ к истории
без входа, запрет выдачи серверных файлов, подключение двух WebSocket-клиентов,
создание комнаты, раздача и завершение партии. Пароль SSH в документации не хранится.

## Альтернативная установка с прямым DNS и Nginx

Следующие шаги описывают отдельный вариант с Nginx и Certbot, а не текущий туннель.
Не выполняйте их поверх работающего сервера без планирования переключения.
Пример рассчитан на Ubuntu 24.04 LTS, Node.js 24 LTS, Nginx и systemd.
Панель https://www.mvps.net/usercp нужна для получения IP и доступа к VPS.
Эти инструкции не переустанавливают ОС. Нужен SSH-доступ с sudo.

## 1. Подготовить архив на компьютере

Из корня проекта:

```powershell
npm run check
node deploy/package-server.cjs
scp artifacts/durak-ubuntu-3.231.tar.gz USER@VPS_IP:/tmp/
```

Замените USER и VPS_IP. Архив содержит сайт, сервер, отдельный package-lock.json
и конфигурации. В него не входят база, сессии, ключи, APK и node_modules.
Серверные зависимости закреплены в `deploy/server/package-lock.json`.
При изменении серверных зависимостей обновляйте и этот манифест/lock.

## 2. Установить ПО на Ubuntu

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx curl ca-certificates xz-utils sqlite3
```

Нужен Node.js 24: старый Node из стандартного репозитория может не иметь node:sqlite.
Пример установки официального бинарного выпуска (проверьте актуальный патч 24 LTS
на https://nodejs.org/en/download перед установкой):

```bash
NODE_VERSION=24.21.0
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *) echo 'Unsupported CPU'; exit 1 ;;
esac
mkdir -p /tmp/durak-node
cd /tmp/durak-node
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz$" SHASUMS256.txt | sha256sum -c -
# Продолжайте только при результате OK.
sudo tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1
/usr/local/bin/node --version
/usr/local/bin/node -e "require('node:sqlite'); console.log('SQLite OK')"
```

## 3. Разместить приложение

```bash
sudo useradd --system --home-dir /var/lib/durak --shell /usr/sbin/nologin durak
sudo install -d -m 755 /opt/durak/releases
sudo install -d -o durak -g durak -m 700 /var/lib/durak
RELEASE=/opt/durak/releases/3.231
sudo install -d -o "$USER" -g "$(id -gn)" "$RELEASE"
tar -xzf /tmp/durak-ubuntu-3.231.tar.gz -C "$RELEASE"
cd "$RELEASE"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo chown -R root:root "$RELEASE"
sudo chmod -R a+rX "$RELEASE"
sudo ln -s "$RELEASE" /opt/durak/current
sudo install -m 600 deploy/durak.env.example /etc/durak.env
sudo install -m 644 deploy/durak.service /etc/systemd/system/durak.service
sudo systemctl daemon-reload
```

При повторном выполнении не создавайте пользователя заново и не перезаписывайте
`/etc/durak.env`. Если Node установлен иначе, исправьте ExecStart в unit-файле.
Для Google-входа внесите существующий GOOGLE_CLIENT_ID в `/etc/durak.env`.
Файл не хранится в Git. База всегда находится в `/var/lib/durak`, вне релизов.

## 4. Перенести аккаунты и статистику

Для сохранения существующих аккаунтов сначала завершите партии и остановите
старый сервер на Windows. Убедитесь, что процесс Node игры завершён. Только после
этого скопируйте **весь** каталог `data` (включая файлы WAL/SHM, если они остались):

```powershell
scp -r data USER@VPS_IP:~/durak-data-import
```

На VPS, до первого запуска новой службы:

```bash
# Не перезаписывайте уже работающую базу. Если она существует — сначала сделайте backup.
sudo test ! -e /var/lib/durak/durak.sqlite
# Продолжайте только если предыдущая команда успешна.
sudo cp -a "$HOME/durak-data-import/." /var/lib/durak/
sudo chown -R durak:durak /var/lib/durak
sudo chmod 700 /var/lib/durak
sudo find /var/lib/durak -type f -exec chmod 600 {} \;
sudo -u durak sqlite3 /var/lib/durak/durak.sqlite 'PRAGMA integrity_check;'
```

Ожидается `ok`. Не запускайте старый и новый сервер на приём новых результатов
одновременно: это две независимые базы. Без импорта будет создана пустая база.
Текущие игровые комнаты не переносятся, поскольку хранятся в памяти.

## 5. Запустить службу и Nginx

```bash
sudo systemctl enable --now durak
curl --fail http://127.0.0.1:3000/api/health
sudo install -m 644 /opt/durak/current/deploy/nginx.conf /etc/nginx/sites-available/durak
sudo ln -s /etc/nginx/sites-available/durak /etc/nginx/sites-enabled/durak
sudo nginx -t
sudo systemctl reload nginx
```

Ожидается `{"app":"durak","status":"ok"}`. Nginx передаёт WebSocket, Host,
исходный IP и протокол. Node слушает только 127.0.0.1; не открывайте порт 3000 наружу.
Работает **один** процесс игры: несколько экземпляров без общей памяти комнат не поддерживаются.

Если включён UFW, разрешите фактический SSH-порт (не обязательно 22), затем
`sudo ufw allow 'Nginx Full'`. Аналогично разрешите TCP 80/443 в firewall MVPS.
Не меняйте SSH/firewall вслепую и не включайте UFW до проверки доступа по SSH.

## 6. Переключить домен и включить HTTPS

В DNS Cloudflare замените старую CNAME-запись туннеля `game` на A-запись с IPv4 VPS.
Удалите устаревшую AAAA или настройте её на реальный IPv6 VPS. На этапе выдачи
сертификата используйте **DNS only**, без проксирования Cloudflare.
Туннель больше не нужен. Приложение уже использует этот домен — новый APK не требуется.

```bash
sudo certbot --nginx -d game.durakcards.uk --redirect
sudo nginx -t
sudo certbot renew --dry-run
curl --fail https://game.durakcards.uk/api/health
```

Certbot попросит email и согласие с условиями. До получения HTTPS не проверяйте вход
по HTTP: COOKIE_SECURE=true специально запрещает отправлять cookie по HTTP.
После переноса проверьте вход в старый аккаунт, историю матчей и комнату с двух
телефонов. Если возвращаете Cloudflare proxy, используйте SSL **Full (strict)**;
для корректных IP-лимитов понадобится отдельно настроить real_ip с официальными
диапазонами Cloudflare. Готовый конфиг рассчитан на DNS only и прямой Nginx.

## Обновление и откат

Загрузите новый архив и распакуйте в **новый** каталог `/opt/durak/releases/ИМЯ`.
В нём выполните `npm ci --omit=dev --ignore-scripts`, затем назначьте root-владельца,
как при установке. `/var/lib/durak` и `/etc/durak.env` при обновлении не трогайте.
Объявите перерыв: перезапуск завершит текущие комнаты.

Перед переключением сделайте согласованную резервную копию SQLite:

```bash
sudo install -d -m 700 /var/backups/durak
sudo sqlite3 /var/lib/durak/durak.sqlite ".backup '/var/backups/durak/before-update.sqlite'"
sudo chmod 600 /var/backups/durak/before-update.sqlite
OLD_RELEASE=$(readlink -f /opt/durak/current)
NEW_RELEASE=/opt/durak/releases/ИМЯ
sudo ln -s "$NEW_RELEASE" /opt/durak/current.next
sudo mv -Tf /opt/durak/current.next /opt/durak/current
sudo systemctl restart durak
curl --retry 10 --retry-connrefused --retry-delay 1 --fail http://127.0.0.1:3000/api/health
```

Если проверка не прошла, изучите журнал и верните предыдущий код:

```bash
sudo ln -s "$OLD_RELEASE" /opt/durak/current.rollback
sudo mv -Tf /opt/durak/current.rollback /opt/durak/current
sudo systemctl restart durak
```

Откат кода не откатывает схему/данные SQLite. При несовместимой миграции восстанавливайте
резервную копию только с остановленной службой и пониманием, что новые записи потеряются.
Храните датированные копии базы также вне VPS; не публикуйте их вместе с кодом.

## Диагностика

```bash
sudo systemctl status durak --no-pager
sudo journalctl -u durak -n 100 --no-pager
sudo nginx -t
sudo ss -ltnp
```

Официальные справочники: [WebSocket в Nginx](https://nginx.org/en/docs/http/websocket.html),
[Express за прокси](https://expressjs.com/en/guide/behind-proxies/),
[Node.js](https://nodejs.org/en/download).
