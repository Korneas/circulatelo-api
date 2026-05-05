export const runtime = "nodejs";

const WF_SITE_ID = process.env.WF_SITE_ID;
const WF_API_TOKEN = process.env.WF_API_TOKEN;
const WF_EVENTS_COLLECTION_NAME = process.env.WF_EVENTS_COLLECTION_NAME || "Events";
const WF_ESPACIOS_COLLECTION_NAME = process.env.WF_ESPACIOS_COLLECTION_NAME || "Espacios";

// 5-minute cache. Survives across requests within the same warm runtime
// instance. A cold start re-fetches; that's fine.
const CACHE_TTL_MS = 5 * 60 * 1000;
let statsCache = null; // { data, expiresAt }

// Module-level collection ID cache so we don't re-resolve names every request.
const collectionIdCache = {};

async function webflowFetch(path, params = {}) {
  const url = new URL(`https://api-cdn.webflow.com${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${WF_API_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow API error ${res.status}: ${text}`);
  }

  return res.json();
}

async function getCollectionIdByName(name) {
  if (collectionIdCache[name]) return collectionIdCache[name];

  const data = await webflowFetch(`/v2/sites/${WF_SITE_ID}/collections`);
  const collections = data.collections || [];

  const collection = collections.find(
    (c) => c.displayName === name || c.slug === name.toLowerCase()
  );

  if (!collection) {
    throw new Error(`Collection not found: ${name}`);
  }

  collectionIdCache[name] = collection.id;
  return collection.id;
}

async function countLiveItems(collectionId) {
  // We only need the total, so fetch the smallest possible page (limit=1)
  // and read pagination.total from the response.
  const data = await webflowFetch(`/v2/collections/${collectionId}/items/live`, {
    limit: 1,
    offset: 0,
  });

  return data?.pagination?.total || 0;
}

async function getAllLiveItems(collectionId) {
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await webflowFetch(`/v2/collections/${collectionId}/items/live`, {
      limit,
      offset,
    });

    const items = data.items || [];
    allItems.push(...items);

    const pagination = data.pagination || {};
    const total = pagination.total || 0;

    offset += limit;
    if (offset >= total || items.length === 0) break;
  }

  return allItems;
}

// Same date parser used by the events route. Handles MM-DD-YYYY and ISO.
function toDateOnly(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
      const [, month, day, year] = match;
      return `${year}-${month}-${day}`;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function computeEventCounts(eventItems) {
  // "Today" boundaries based on local server time. Webflow stores dates as
  // calendar dates without timezones, so we compare YYYY-MM-DD strings.
  const now = new Date();
  const todayKey = toDateOnly(now);
  const monthPrefix = todayKey.slice(0, 7); // "YYYY-MM"

  let eventsThisMonth = 0;
  let eventsUpcoming = 0;

  eventItems.forEach((item) => {
    const f = item.fieldData || {};
    const startDate = toDateOnly(f["fecha-de-inicio"]);
    if (!startDate) return;

    const endDate = toDateOnly(f["fecha-de-final"]) || startDate;

    // Events this month: any event whose range touches the current calendar
    // month (regardless of whether it's already happened).
    // Range overlaps [first-of-month, last-of-month] iff
    //   startDate <= last-of-month AND endDate >= first-of-month.
    // We only need to compare the YYYY-MM prefix: a range overlaps the
    // current month iff start's month <= current month <= end's month.
    const startMonth = startDate.slice(0, 7);
    const endMonth = endDate.slice(0, 7);
    if (startMonth <= monthPrefix && endMonth >= monthPrefix) {
      eventsThisMonth++;
    }

    // Upcoming events: end date is today or later.
    if (endDate >= todayKey) {
      eventsUpcoming++;
    }
  });

  return { eventsThisMonth, eventsUpcoming };
}

async function buildStats() {
  const [eventsCollectionId, espaciosCollectionId] = await Promise.all([
    getCollectionIdByName(WF_EVENTS_COLLECTION_NAME),
    getCollectionIdByName(WF_ESPACIOS_COLLECTION_NAME),
  ]);

  // Run both in parallel: a count call for spaces, a full fetch for events
  // (we need each event's dates to compute the breakdowns).
  const [spaces, eventItems] = await Promise.all([
    countLiveItems(espaciosCollectionId),
    getAllLiveItems(eventsCollectionId),
  ]);

  const { eventsThisMonth, eventsUpcoming } = computeEventCounts(eventItems);

  return {
    spaces,
    eventsThisMonth,
    eventsUpcoming,
    generatedAt: new Date().toISOString(),
  };
}

export async function GET() {
  try {
    if (!WF_SITE_ID || !WF_API_TOKEN) {
      return Response.json(
        { error: "Missing WF_SITE_ID or WF_API_TOKEN environment variables." },
        { status: 500 }
      );
    }

    // Serve from cache if fresh.
    const now = Date.now();
    if (statsCache && statsCache.expiresAt > now) {
      return Response.json(statsCache.data, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    }

    const data = await buildStats();
    statsCache = { data, expiresAt: now + CACHE_TTL_MS };

    return Response.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  } catch (error) {
    console.error("STATS API ERROR", error);

    // If the live fetch fails but we have a stale cache, serve it rather
    // than 500-ing the homepage. Better to show slightly old numbers than
    // broken counters.
    if (statsCache?.data) {
      return Response.json(
        { ...statsCache.data, stale: true },
        { headers: { "Cache-Control": "public, max-age=30" } }
      );
    }

    return Response.json(
      { error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}