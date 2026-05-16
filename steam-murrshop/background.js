const MURRSHOP_CHECK_ENDPOINT = "https://murrshop.ru/wp-json/steam/v1/check";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
