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

  const state = {
    appId: null,
    requestedAppId: null,
    requestInProgress: false,
    retryAttempts: 0,
    status: null,
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

    const appChanged = resetStateIfAppChanged(appId);
    const buttonsReady = ensureTopButtons(appId, getAppName());
    if (!buttonsReady) {
      return;
    }

    if (appChanged) {
      renderMurrShopButtonLoading(appId);
    }

    if (state.status !== null) {
      renderStatus(appId, state.status);
    }

    requestStatusOnce(appId);
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

    return true;
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
    button.title = "Найти на pplati.ru";
    button.textContent = "🔍";

    return button;
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

  function renderMurrShopButtonUnavailable(appId, title) {
    const button = document.getElementById(MURRSHOP_BUTTON_ID);
    if (!button) {
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
