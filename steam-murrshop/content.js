(() => {
  "use strict";

  const BUTTONS_CONTAINER_ID = "murrshop-buttons-container";
  const SEARCH_BUTTON_ID = "murrshop-search-btn";
  const MURRSHOP_BUTTON_ID = "murrshop-app-btn";
  const PRICE_BLOCK_CLASS = "murrshop-price-block";
  const RETRY_DELAY_MS = 1500;
  const MAX_RETRY_ATTEMPTS = 3;
  const DOM_SYNC_DEBOUNCE_MS = 100;
  const OBSERVER_ROOT_SELECTORS = [
    ".apphub_OtherSiteInfo",
    ".game_area_purchase_game_wrapper",
  ];
  // Страница ошибки «Данный товар недоступен в вашем регионе» (RU/EN варианты)
  const REGION_BLOCKED_PATTERN =
    /недоступен в вашем регионе|unavailable in your (region|country)/i;
  // Слаг страницы ошибки, который Steam подставляет в URL («Ошибка веб-страницы»)
  const ERROR_SLUG_PATTERN = /^(ошибка|site error|error)/i;
  const BLOCKED_PANEL_CLASS = "murrshop-blocked-panel";
  // Страховка от зависшего запроса названия через зеркало
  const BLOCKED_NAME_TIMEOUT_MS = 15000;

  const state = {
    appId: null,
    requestedAppId: null,
    requestInProgress: false,
    retryAttempts: 0,
    status: null,
  };

  const platiState = {
    requestedAppId: null,
    requestInProgress: false,
    retryAttempts: 0,
  };

  // Страница недоступной в регионе игры: запрос названия через зеркало
  const blockedState = {
    nameRequestedFor: null,
    nameResolvedFor: null,
    nameWatchdogTimerId: null,
  };

  function initialize() {
    syncPage();
    observeSteamContainers();
  }

  function observeSteamContainers() {
    let syncTimerId = null;
    const observer = new MutationObserver(() => {
      if (syncTimerId !== null) {
        window.clearTimeout(syncTimerId);
      }

      syncTimerId = window.setTimeout(() => {
        syncTimerId = null;
        syncPage();
      }, DOM_SYNC_DEBOUNCE_MS);
    });

    const observedRoots = OBSERVER_ROOT_SELECTORS.map((selector) =>
      document.querySelector(selector),
    ).filter((root) => root !== null);

    if (observedRoots.length === 0) {
      observer.observe(document.body, { childList: true });
      return;
    }

    observedRoots.forEach((root) => {
      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function syncPage() {
    const appId = getAppId();
    if (appId === null) {
      return;
    }

    // У недоступных в регионе игр страница ошибки без шапки Steam (.apphub_*)
    if (isRegionBlockedPage()) {
      syncBlockedPage(appId);
      return;
    }

    const appChanged = resetStateIfAppChanged(appId);
    const buttonsReady = ensureTopButtons(appId, getAppName());
    if (!buttonsReady) {
      return;
    }

    if (appChanged) {
      renderMurrShopButtonLoading(appId);
      renderSearchButtonLoading();
    }

    if (state.status !== null) {
      renderStatus(appId, state.status);
    }

    requestStatusOnce(appId);
    requestPlatiCountOnce(appId, getAppName());
  }

  function resetStateIfAppChanged(appId) {
    if (state.appId === appId) {
      return false;
    }

    state.appId = appId;
    state.requestedAppId = null;
    state.requestInProgress = false;
    state.retryAttempts = 0;
    state.status = null;

    platiState.requestedAppId = null;
    platiState.requestInProgress = false;
    platiState.retryAttempts = 0;

    blockedState.nameRequestedFor = null;
    blockedState.nameResolvedFor = null;
    if (blockedState.nameWatchdogTimerId !== null) {
      window.clearTimeout(blockedState.nameWatchdogTimerId);
      blockedState.nameWatchdogTimerId = null;
    }

    return true;
  }

  // --- Страница недоступной в регионе игры ---

  // Панель с двумя подписанными кнопками (plati + MurrShop) в начале блока
  // контента страницы ошибки. Названия игры в DOM нет, поэтому грузим его
  // через background (зеркало appdetails MurrShop) и уточняем ссылку поиска.
  function syncBlockedPage(appId) {
    const appChanged = resetStateIfAppChanged(appId);
    if (!ensureBlockedPanel(appId)) {
      return;
    }

    if (appChanged) {
      renderSearchButtonLoading();
    }

    if (state.status !== null) {
      renderStatus(appId, state.status);
    }

    requestStatusOnce(appId);
    requestBlockedGameNameOnce(appId);
  }

  function ensureBlockedPanel(appId) {
    const errorBox = document.getElementById("error_box");
    const pageContent = errorBox?.closest(".page_content");
    if (!pageContent) {
      return false;
    }

    if (document.getElementById(BUTTONS_CONTAINER_ID)) {
      return true;
    }

    const container = document.createElement("div");
    container.id = BUTTONS_CONTAINER_ID;
    container.dataset.labeled = "1";
    container.classList.add(BLOCKED_PANEL_CLASS);
    container.append(
      createBlockedSearchButton(),
      createBlockedMurrShopButton(appId),
    );
    pageContent.insertBefore(container, pageContent.firstChild);

    return true;
  }

  // Кнопка MurrShop с подписью: скрыта, пока игра не найдена на сайте
  function createBlockedMurrShopButton(appId) {
    const button = createMurrShopButton(appId);
    button.classList.add("murrshop-app-btn-labeled");
    button.dataset.renderedText = "hidden";
    button.style.display = "none";

    return button;
  }

  // Кнопка поиска с текстовой подписью — на странице ошибки места много
  function createBlockedSearchButton() {
    const button = createSearchButton("");
    button.classList.add("murrshop-search-btn-labeled");
    button.href = "https://pplati.ru/";
    button.title = "Получаем название игры...";
    button.dataset.renderedText = "loading";
    button.replaceChildren(
      document.createTextNode("🔍 Получаем название…"),
    );

    return button;
  }

  function requestBlockedGameNameOnce(appId) {
    if (blockedState.nameRequestedFor === appId) {
      return;
    }

    blockedState.nameRequestedFor = appId;

    // Страховка: если background так и не ответил (зеркало недоступен,
    // воркер остановлен и т.п.), через таймаут уходим в резервное имя
    blockedState.nameWatchdogTimerId = window.setTimeout(() => {
      blockedState.nameWatchdogTimerId = null;
      if (state.appId === appId) {
        handleBlockedGameName(appId, null);
      }
    }, BLOCKED_NAME_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage(
        { action: "getGameName", appId },
        (response) => handleBlockedGameName(appId, response),
      );
    } catch {
      handleBlockedGameName(appId, null);
    }
  }

  function handleBlockedGameName(appId, response) {
    if (state.appId !== appId || blockedState.nameResolvedFor === appId) {
      return;
    }

    blockedState.nameResolvedFor = appId;
    if (blockedState.nameWatchdogTimerId !== null) {
      window.clearTimeout(blockedState.nameWatchdogTimerId);
      blockedState.nameWatchdogTimerId = null;
    }

    // Прямой appdetails Steam для недоступных игр молчит, background берёт
    // название через зеркало MurrShop; если не вышло — слаг URL
    const mirroredName =
      !chrome.runtime.lastError && response && response.ok && response.name
        ? String(response.name).trim()
        : null;
    const name =
      mirroredName && !mirroredName.startsWith("Игра ")
        ? mirroredName
        : getAppNameFromSlug();

    if (!name) {
      renderSearchButtonNoQuery();
      return;
    }

    applyBlockedSearchName(appId, name);
  }

  function applyBlockedSearchName(appId, name) {
    const button = document.getElementById(SEARCH_BUTTON_ID);
    if (!button || state.appId !== appId) {
      return;
    }

    button.dataset.renderedText = "loading";
    button.title = "Ищем предложения на plati.market...";
    button.href = createPplatiSearchUrl(name);
    button.replaceChildren(
      document.createTextNode("🔍 Искать на plati.market…"),
      createLoaderElement(),
    );

    requestPlatiCountOnce(appId, name);
  }

  function renderSearchButtonNoQuery() {
    const button = document.getElementById(SEARCH_BUTTON_ID);
    if (!button) {
      return;
    }

    button.dataset.renderedText = "no-query";
    button.classList.remove("murrshop-zero-offers");
    button.href = "https://pplati.ru/";
    button.title = "Найти на pplati.ru";
    button.replaceChildren(
      document.createTextNode("🔍 Искать на plati.market"),
    );
  }

  function ensureTopButtons(appId, appName) {
    const host = document.querySelector(".apphub_OtherSiteInfo");
    if (!host) {
      return false;
    }

    const container = document.getElementById(BUTTONS_CONTAINER_ID);
    if (container) {
      updateTopButtonLinks(appId, appName);
      return true;
    }

    const nextContainer = document.createElement("div");
    nextContainer.id = BUTTONS_CONTAINER_ID;
    nextContainer.append(
      createSearchButton(appName || appId),
      createMurrShopButton(appId),
    );
    host.appendChild(nextContainer);

    return true;
  }

  function updateTopButtonLinks(appId, appName) {
    const searchButton = document.getElementById(SEARCH_BUTTON_ID);
    const murrShopButton = document.getElementById(MURRSHOP_BUTTON_ID);

    if (searchButton) {
      searchButton.href = createPplatiSearchUrl(appName || appId);
    }

    if (murrShopButton) {
      murrShopButton.href = createMurrShopAppUrl(appId);
    }
  }

  function createSearchButton(query) {
    const button = document.createElement("a");
    button.id = SEARCH_BUTTON_ID;
    button.className = "murrshop-ext-btn murrshop-search-btn";
    button.href = createPplatiSearchUrl(query);
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.title = "Ищем предложения на plati.market...";
    button.dataset.renderedText = "loading";
    button.append(
      document.createTextNode("🔍"),
      createLoaderElement(),
    );

    return button;
  }

  function createLoaderElement() {
    const loader = document.createElement("span");
    loader.className = "murrshop-top-loader";

    return loader;
  }

  function createMurrShopButton(appId) {
    const button = document.createElement("a");
    button.id = MURRSHOP_BUTTON_ID;
    button.className = "murrshop-ext-btn murrshop-app-btn";
    button.href = createMurrShopAppUrl(appId);
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    renderMurrShopButtonLoading(appId, button);

    return button;
  }

  function requestStatusOnce(appId) {
    if (state.requestInProgress || state.requestedAppId === appId) {
      return;
    }

    state.requestInProgress = true;
    state.requestedAppId = appId;

    chrome.runtime.sendMessage(
      { action: "checkGameStatus", appId },
      (response) => handleStatusResponse(appId, response),
    );
  }

  function handleStatusResponse(appId, response) {
    state.requestInProgress = false;

    if (state.appId !== appId) {
      return;
    }

    if (chrome.runtime.lastError || !response || response.ok === false) {
      retryStatusRequest(appId);
      return;
    }

    state.retryAttempts = 0;
    state.status = normalizeStatus(response);
    renderStatus(appId, state.status);
  }

  function retryStatusRequest(appId) {
    state.requestedAppId = null;
    state.retryAttempts += 1;

    if (state.retryAttempts > MAX_RETRY_ATTEMPTS) {
      renderMurrShopButtonUnavailable(appId, "Ошибка проверки цены MurrShop");
      return;
    }

    const retryDelay = RETRY_DELAY_MS * 2 ** (state.retryAttempts - 1);

    window.setTimeout(() => {
      if (state.appId === appId) {
        requestStatusOnce(appId);
      }
    }, retryDelay);
  }

  function requestPlatiCountOnce(appId, appName) {
    if (platiState.requestInProgress || platiState.requestedAppId === appId) {
      return;
    }

    if (!appName) {
      return;
    }

    platiState.requestInProgress = true;
    platiState.requestedAppId = appId;

    chrome.runtime.sendMessage(
      { action: "getPlatiCount", appId, appName },
      (response) => handlePlatiCountResponse(appId, appName, response),
    );
  }

  function handlePlatiCountResponse(appId, appName, response) {
    platiState.requestInProgress = false;

    if (state.appId !== appId) {
      return;
    }

    if (
      chrome.runtime.lastError ||
      !response ||
      response.ok !== true ||
      !response.payload
    ) {
      retryPlatiCountRequest(appId, appName);
      return;
    }

    platiState.retryAttempts = 0;
    renderSearchButtonPlati(appId, appName, response.payload);
  }

  function retryPlatiCountRequest(appId, appName) {
    platiState.retryAttempts += 1;

    if (platiState.retryAttempts > MAX_RETRY_ATTEMPTS) {
      renderSearchButtonError(appId);
      return;
    }

    platiState.requestedAppId = null;
    const retryDelay = RETRY_DELAY_MS * 2 ** (platiState.retryAttempts - 1);

    window.setTimeout(() => {
      if (state.appId === appId) {
        requestPlatiCountOnce(appId, appName);
      }
    }, retryDelay);
  }

  function renderSearchButtonLoading() {
    const button = document.getElementById(SEARCH_BUTTON_ID);
    if (!button) {
      return;
    }

    button.title = "Ищем предложения на plati.market...";
    button.dataset.renderedText = "loading";
    button.classList.remove("murrshop-zero-offers");
    button.replaceChildren(
      document.createTextNode(isLabeledPanel() ? "🔍 Получаем название…" : "🔍"),
      createLoaderElement(),
    );
  }

  function renderSearchButtonPlati(appId, appName, payload) {
    const button = document.getElementById(SEARCH_BUTTON_ID);
    if (!button || state.appId !== appId) {
      return;
    }

    const renderedText = `${payload.filtered}:${payload.minPrice}`;
    if (button.dataset.renderedText === renderedText) {
      return;
    }

    button.dataset.renderedText = renderedText;
    button.classList.toggle("murrshop-zero-offers", payload.filtered === 0);
    button.title = createPlatiTitle(appName, payload);

    if (isLabeledPanel()) {
      button.replaceChildren(
        document.createTextNode(
          `🔍 На plati: ${payload.filtered} ${pluralizeOffers(payload.filtered)}`,
        ),
      );
    } else {
      button.replaceChildren(
        document.createTextNode(`🔍 ${payload.filtered}`),
      );
    }

    if (payload.filtered > 0 && payload.minPrice !== null) {
      const price = document.createElement("span");
      price.className = "murrshop-plati-price";
      price.textContent = isLabeledPanel()
        ? ` · от ${payload.minPrice} ₽`
        : ` · ${payload.minPrice}`;
      button.appendChild(price);
    }
  }

  function renderSearchButtonError(appId) {
    const button = document.getElementById(SEARCH_BUTTON_ID);
    if (!button || state.appId !== appId) {
      return;
    }

    button.dataset.renderedText = "error";
    button.classList.remove("murrshop-zero-offers");
    button.title = "Не удалось получить количество предложений plati.market";
    button.replaceChildren(
      document.createTextNode(isLabeledPanel() ? "🔍 Искать на plati.market" : "🔍 ?"),
    );
  }

  function createPlatiTitle(appName, payload) {
    const totalPart =
      payload.total > payload.filtered ? ` (всего ${payload.total})` : "";

    if (payload.filtered === 0) {
      return `Нет предложений plati.market после фильтров${totalPart} — поиск: «${appName}»`;
    }

    const pricePart =
      payload.minPrice !== null ? `, от ${payload.minPrice} ₽` : "";

    return `${payload.filtered} ${pluralizeOffers(payload.filtered)} на plati.market${totalPart}${pricePart} — поиск: «${appName}»`;
  }

  function pluralizeOffers(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return "предложение";
    }

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return "предложения";
    }

    return "предложений";
  }

  function normalizeStatus(response) {
    return {
      exists: response.exists === true,
      price: typeof response.price === "string" ? response.price : null,
      bestMarketPrice: normalizeBestMarketPrice(response.bestMarketPrice),
    };
  }

  function normalizeBestMarketPrice(bestMarketPrice) {
    if (!bestMarketPrice || typeof bestMarketPrice !== "object") {
      return null;
    }

    if (
      typeof bestMarketPrice.price !== "string" ||
      typeof bestMarketPrice.date !== "string"
    ) {
      return null;
    }

    return {
      price: bestMarketPrice.price,
      date: bestMarketPrice.date,
    };
  }

  function renderStatus(appId, status) {
    renderMurrShopButton(appId, status);
    renderPriceBlock(appId, status);
  }

  function renderMurrShopButtonLoading(appId, button = null) {
    const target = button || document.getElementById(MURRSHOP_BUTTON_ID);
    if (!target) {
      return;
    }

    target.href = createMurrShopAppUrl(appId);
    target.title = "Проверяем цену на MurrShop";
    target.dataset.renderedText = "loading";

    const loader = document.createElement("span");
    loader.className = "murrshop-top-loader";
    target.replaceChildren(document.createTextNode("😺"), loader);
  }

  function renderMurrShopButton(appId, status) {
    const button = document.getElementById(MURRSHOP_BUTTON_ID);
    if (!button) {
      return;
    }

    if (isLabeledPanel()) {
      renderBlockedMurrShopButton(button, appId, status);
      return;
    }

    const renderedText =
      status.exists && status.price !== null ? `😺 ${status.price} ₽` : "😺";

    button.href = createMurrShopAppUrl(appId);
    button.title = status.exists
      ? "Открыть игру на MurrShop"
      : "Игра не найдена на MurrShop";

    if (button.dataset.renderedText === renderedText) {
      return;
    }

    button.dataset.renderedText = renderedText;
    button.replaceChildren(document.createTextNode("😺"));

    if (status.exists && status.price !== null) {
      const price = document.createElement("span");
      price.className = "murrshop-top-price";
      price.textContent = `${status.price} ₽`;
      button.appendChild(price);
    }
  }

  // Кнопка MurrShop на странице ошибки: показываем только если игра есть на сайте
  function renderBlockedMurrShopButton(button, appId, status) {
    button.href = createMurrShopAppUrl(appId);

    if (!status.exists) {
      button.dataset.renderedText = "hidden";
      button.style.display = "none";
      return;
    }

    button.style.display = "";
    button.title = "Открыть игру на MurrShop";

    const renderedText = status.price !== null ? `😺 ${status.price} ₽` : "😺";
    if (button.dataset.renderedText === renderedText) {
      return;
    }

    button.dataset.renderedText = renderedText;
    button.replaceChildren(document.createTextNode("😺 Открыть на MurrShop"));

    if (status.price !== null) {
      const price = document.createElement("span");
      price.className = "murrshop-top-price";
      price.textContent = ` · ${status.price} ₽`;
      button.appendChild(price);
    }
  }

  function renderMurrShopButtonUnavailable(appId, title) {
    const button = document.getElementById(MURRSHOP_BUTTON_ID);
    if (!button) {
      return;
    }

    if (isLabeledPanel()) {
      button.dataset.renderedText = "hidden";
      button.style.display = "none";
      return;
    }

    button.href = createMurrShopAppUrl(appId);
    button.title = title;
    button.dataset.renderedText = "😺";
    button.replaceChildren(document.createTextNode("😺"));
  }

  function renderPriceBlock(appId, status) {
    const purchaseWrapper = document.querySelector(
      ".game_area_purchase_game_wrapper",
    );
    if (!purchaseWrapper) {
      return;
    }

    const existingBlock = purchaseWrapper.querySelector(
      `.${PRICE_BLOCK_CLASS}`,
    );
    if (!status.exists || status.price === null) {
      existingBlock?.remove();
      return;
    }

    const signature = createPriceBlockSignature(appId, status);
    if (existingBlock?.dataset.signature === signature) {
      return;
    }

    const priceBlock = createPriceBlock(appId, status);
    priceBlock.dataset.signature = signature;

    if (existingBlock) {
      existingBlock.replaceWith(priceBlock);
      return;
    }

    purchaseWrapper.insertBefore(priceBlock, purchaseWrapper.firstChild);
  }

  function createPriceBlock(appId, status) {
    const textContainer = document.createElement("div");
    textContainer.className = "murrshop-price-text-container";
    textContainer.appendChild(
      createPriceLine(
        "murrshop-price-text",
        "Цена на MurrShop.ru: от ",
        status.price,
      ),
    );

    if (status.bestMarketPrice !== null) {
      textContainer.appendChild(
        createPriceLine(
          "murrshop-best-price-text",
          `рекорд ${formatDate(status.bestMarketPrice.date)}: `,
          status.bestMarketPrice.price,
        ),
      );
    }

    const block = document.createElement("div");
    block.className = PRICE_BLOCK_CLASS;
    block.append(textContainer, createViewButton(appId));

    return block;
  }

  function createPriceLine(className, prefix, price) {
    const value = document.createElement("span");
    value.className = "murrshop-price-value";
    value.textContent = `${price} руб.`;

    const line = document.createElement("span");
    line.className = className;
    line.append(document.createTextNode(prefix), value);

    return line;
  }

  function createViewButton(appId) {
    const link = document.createElement("a");
    link.role = "button";
    link.className = "btn_green_steamui btn_medium";
    link.href = createMurrShopAppUrl(appId);
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const label = document.createElement("span");
    label.textContent = "Посмотреть";
    link.appendChild(label);

    const container = document.createElement("div");
    container.className = "btn_addtocart";
    container.appendChild(link);

    return container;
  }

  function createPriceBlockSignature(appId, status) {
    return [
      appId,
      status.price,
      status.bestMarketPrice ? status.bestMarketPrice.price : "",
      status.bestMarketPrice ? status.bestMarketPrice.date : "",
    ].join(":");
  }

  function getAppId() {
    const match = window.location.pathname.match(/\/app\/(\d+)(?:\/|$)/);

    return match ? match[1] : null;
  }

  function getAppName() {
    const appName = document.querySelector(".apphub_AppName");

    return appName ? appName.textContent.trim() : null;
  }

  // Страница ошибки «недоступно в вашем регионе»: блок #error_box есть,
  // а шапки Steam (.apphub_*) — нет
  function isRegionBlockedPage() {
    const errorBox = document.getElementById("error_box");

    return (
      errorBox !== null && REGION_BLOCKED_PATTERN.test(errorBox.textContent || "")
    );
  }

  // Название игры из слага URL (/app/1817190/Marvels_SpiderMan_Miles_Morales/) —
  // резерв для страниц ошибки, где названия нет в DOM
  function getAppNameFromSlug() {
    const match = window.location.pathname.match(/\/app\/\d+\/([^/]+)/);
    if (!match) {
      return null;
    }

    try {
      const name = decodeURIComponent(match[1]).replace(/_/g, " ").trim();
      if (!name || ERROR_SLUG_PATTERN.test(name)) {
        return null;
      }

      return name;
    } catch {
      return null;
    }
  }

  // Панель создана в режиме текстовых подписей (страница недоступной игры)
  function isLabeledPanel() {
    const container = document.getElementById(BUTTONS_CONTAINER_ID);

    return !!container && container.dataset.labeled === "1";
  }

  function createPplatiSearchUrl(query) {
    const url = new URL("https://pplati.ru/");
    url.searchParams.set("search", query);

    return url.toString();
  }

  function createMurrShopAppUrl(appId) {
    return `https://murrshop.ru/app/${appId}/`;
  }

  function formatDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }

    const [year, month, day] = date.split("-");

    return `${day}.${month}.${year}`;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
