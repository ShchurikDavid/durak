# Вход через Google

Используется Google Identity Services: пользователь выбирает Google-аккаунт,
сервер проверяет подпись ID-токена, получателя, издателя, срок действия и одноразовый
nonce, связанный с сессией браузера. Пароль Google сайт не получает.

## Подключение

1. В [Google Cloud Console](https://console.cloud.google.com/) создайте или выберите проект.
2. Настройте Google Auth Platform: Branding, Audience и OAuth client типа **Web application**.
3. В **Authorized JavaScript origins** добавьте точный адрес сайта, например
   `http://localhost:3000` для локальной проверки и `https://game.durakcards.uk` для сайта.
   Путь после домена не указывается. Для этого варианта с JavaScript callback
   redirect URI и client secret не нужны.
4. Если проект находится в режиме Testing, добавьте нужные Google-аккаунты в Test users.
5. Установите переменную окружения `GOOGLE_CLIENT_ID` и перезапустите сервер:

```powershell
$env:GOOGLE_CLIENT_ID = 'ваш-client-id.apps.googleusercontent.com'
npm start
```

На публичном сайте нужен HTTPS; включите `COOKIE_SECURE=true`.
При смене адреса Cloudflare Tunnel новый origin также нужно добавить в Google Console.
Для работы Google предпочтителен постоянный домен. Обычный вход и гостевой режим
продолжают работать без настройки Google. В форме будет указано, что Google пока не подключён.

Первый вход создаёт отдельный игровой аккаунт. Повторный вход находит его по
постоянному Google ID (`sub`), сохраняя выбранный в настройках ник.
Существующие аккаунты с паролем автоматически не объединяются с Google-аккаунтами.
Приложение не запрашивает доступ к письмам Gmail и не сохраняет Google ID-токены.

Инструкции Google: [настройка веб-клиента](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid),
[проверка ID-токенов](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Автоматические тесты проверяют создание и повторный вход, сохранение ника, подмену
сессии и повторное использование токена. Полная проверка с настоящим Google-аккаунтом
требует настроенного OAuth-клиента и разрешённого origin.
