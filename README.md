# Steam MurrShop Viewer

Chrome-расширение для страниц игр Steam, которое добавляет ссылки на MurrShop.ru и показывает цену игры прямо на странице Steam.

## Репозиторий

`steam-murrshop`

## Автор

**Dark Wizard**  
Сайт автора: [darktech.ru](https://darktech.ru)

## Сайт проекта

[murrshop.ru](https://murrshop.ru)

## Возможности

- Добавляет кнопку поиска игры на `pplati.ru`.
- Добавляет кнопку просмотра игры на `murrshop.ru`.
- Проверяет наличие игры через публичный endpoint MurrShop.
- Показывает цену MurrShop в верхней кнопке на странице Steam.
- Добавляет блок `.murrshop-price-block` с ценой MurrShop.
- Показывает рекордную цену, если API возвращает поле `best_market_price`.

## Скриншоты

![Steam MurrShop Viewer screenshot 1](screenshots/1.jpg)

![Steam MurrShop Viewer screenshot 2](screenshots/2.jpg)

## Установка из исходников

1. Скачайте и разархивируйте архив steam-murrshop.zip , или скачайте папку steam-murrshop.
2. Откройте в chrome браузере страницу `chrome://extensions/`.
3. Включите режим разработчика.
4. Нажмите **Load unpacked** / **Загрузить распакованное расширение**.
5. Выберите каталог `steam-murrshop/`.

## Заметка

На сайте murrshop.ru пока есть не все игры, но они добавляются каждый день. Используйте поиск на сайте или напишите через форму разработчику, если какой-то игры нет. Также всегда можно поискать игру через парсер https://pplati.ru (этот плагин также добавляет кнопку поиска).

## Файлы расширения

- [`manifest.json`](steam-murrshop/manifest.json) — конфигурация Chrome Extension Manifest V3.
- [`content.js`](steam-murrshop/content.js) — вставка кнопок и блока цены на страницу Steam.
- [`content.css`](steam-murrshop/content.css) — стили кнопок и блока цены.
- [`background.js`](steam-murrshop/background.js) — проверка игры через MurrShop API.
- [`icon16.png`](steam-murrshop/icon16.png), [`icon48.png`](steam-murrshop/icon48.png), [`icon128.png`](steam-murrshop/icon128.png) — иконки расширения.
