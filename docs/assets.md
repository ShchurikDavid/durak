# Графика

Изображения не изменялись при рефакторинге. Каждый набор находится в
`public/cards/<скин>/`, рядом лежит `manifest.json` с описанием происхождения.
Пользовательские SVG и значки интерфейса находятся в `public/icons/`.

## Сведения из прежнего README

The game now uses one consistent 54-card visual set based on public-domain/CC0
artwork from AustinGabriel's Public-Domain-and-CC0-Playing-Cards repository.
The set includes all 52 cards, two jokers, and blue/red backs. No user photographs
are included. The source repository states that its assets are CC0/public domain
and suitable for commercial and non-commercial use.

Это сохранённое описание источника из прежней документации проекта.
Каталог отображаемых скинов теперь находится в `public/js/cards.js`.

Android использует копии тех же PNG в `mobile/assets/cards/` вместе с исходными
описаниями происхождения. `mobile/cards.ts` перечисляет статические ссылки для
включения изображений в APK. Фоновая музыка скопирована из `public/bg-music.mp3`
в `android/app/src/main/res/raw/bg_music.mp3`. Короткие WAV-эффекты повторяют
шумовые удары из `public/js/settings.js`: фильтр 350/450 Гц, затухание и тройной
звук при взятии/отбое. Загрузка ресурсов с сайта во время игры не требуется.
