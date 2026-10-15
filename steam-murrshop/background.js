const MURRSHOP_CHECK_ENDPOINT = "https://murrshop.ru/wp-json/steam/v1/check";
const PPLATI_COUNT_ENDPOINT = "https://pplati.ru/api.php";
const PPLATI_COUNT_TTL_MS = 12 * 60 * 60 * 1000; // как серверный кэш pplati.ru
const PPLATI_COUNT_CACHE_PREFIX = "platiCount:";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "getPlatiCount") {
    getPlatiCount(request.appId, request.appName)
      .then((payload) => sendResponse({ ok: payload !== null, payload }))
      .catch((error) => {
        console.warn("pplati count failed", error);
        sendResponse({ ok: false, payload: null });
      });
    return true;
  }

  if (!request || request.action !== "checkGameStatus") {
    return false;
  }

  const appId = normalizeAppId(request.appId);
  if (appId === null) {
    sendResponse(createEmptyStatus(false));
    return false;
  }

  checkGameStatus(appId)
    .then((status) => sendResponse({ ok: true, ...status }))
    .catch((error) => {
      console.warn("MurrShop check failed", error);
      sendResponse(createEmptyStatus(false));
    });

  return true;
});

async function checkGameStatus(appId) {
  const url = new URL(MURRSHOP_CHECK_ENDPOINT);
  url.searchParams.set("ids", appId);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`MurrShop check failed: ${response.status}`);
  }

  const data = await parseJsonResponse(response);

  return mapGameStatus(data, appId);
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("MurrShop check failed: invalid content type");
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(
      `MurrShop check failed: invalid JSON: ${getErrorMessage(error)}`,
    );
  }
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function mapGameStatus(data, appId) {
  if (!data || typeof data !== "object") {
    return createEmptyStatus();
  }

  if (!data.existing || typeof data.existing !== "object") {
    return createEmptyStatus();
  }

  const gameData = data.existing[appId];
  if (!gameData || typeof gameData !== "object") {
    return createEmptyStatus();
  }

  return {
    exists: true,
    price: normalizePrice(gameData.start_price),
    bestMarketPrice: normalizeBestMarketPrice(gameData.best_market_price),
  };
}

function normalizeBestMarketPrice(bestMarketPrice) {
  if (!bestMarketPrice || typeof bestMarketPrice !== "object") {
    return null;
  }

  const price = normalizePrice(bestMarketPrice.price);
  const date = normalizeDate(bestMarketPrice.date);

  if (price === null || date === null) {
    return null;
  }

  return { price, date };
}

function normalizeAppId(appId) {
  const value = String(appId ?? "").trim();

  return /^\d+$/.test(value) ? value : null;
}

function normalizePrice(price) {
  if (price === null || price === undefined || price === "") {
    return null;
  }

  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.0+$/, "");
}

function normalizeDate(date) {
  const value = String(date ?? "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function createEmptyStatus(ok = true) {
  return {
    ok,
    exists: false,
    price: null,
    bestMarketPrice: null,
  };
}

// Количество предложений игры на plati.market (через pplati.ru, с кэшем)
async function getPlatiCount(appId, appName) {
  const normalizedAppId = normalizeAppId(appId);
  const name = String(appName ?? "").trim();

  if (normalizedAppId === null || name === "") {
    return null;
  }

  const storageKey = PPLATI_COUNT_CACHE_PREFIX + normalizedAppId;
  const cached = await readCachedPlatiCount(storageKey);
  if (cached !== null) {
    return cached;
  }

  const url = new URL(PPLATI_COUNT_ENDPOINT);
  url.searchParams.set("search", name);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`pplati count failed: ${response.status}`);
  }

  const data = await response.json();

  // ok:false (plati недоступен и т.п.) — не кэшируем, чтобы повторить позже
  if (!data || data.ok !== true) {
    return null;
  }

  const payload = normalizePlatiCount(data);
  await chrome.storage.local.set({
    [storageKey]: { fetchedAt: Date.now(), payload },
  });
  schedulePlatiCountCleanup();

  return payload;
}

async function readCachedPlatiCount(storageKey) {
  const stored = await chrome.storage.local.get(storageKey);
  const entry = stored[storageKey];

  if (!entry || typeof entry.fetchedAt !== "number" || !entry.payload) {
    return null;
  }

  return Date.now() - entry.fetchedAt < PPLATI_COUNT_TTL_MS
    ? entry.payload
    : null;
}

function normalizePlatiCount(data) {
  return {
    filtered: Number(data.filtered) || 0,
    total: Number(data.total) || 0,
    minPrice:
      data.min_price === null || data.min_price === undefined
        ? null
        : Number(data.min_price),
  };
}

// Удаляем протухшие записи кэша, чтобы хранилище не росло бесконечно
function schedulePlatiCountCleanup() {
  chrome.storage.local.get(null).then((items) => {
    const expired = Object.keys(items).filter((key) => {
      if (!key.startsWith(PPLATI_COUNT_CACHE_PREFIX)) {
        return false;
      }

      const entry = items[key];
      return (
        !entry ||
        typeof entry.fetchedAt !== "number" ||
        Date.now() - entry.fetchedAt >= PPLATI_COUNT_TTL_MS
      );
    });

    if (expired.length > 0) {
      chrome.storage.local.remove(expired);
    }
  });
}
