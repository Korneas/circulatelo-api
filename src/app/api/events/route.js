export const runtime = "edge";

const WF_SITE_ID = process.env.WF_SITE_ID;
const WF_API_TOKEN = process.env.WF_API_TOKEN;
const WF_EVENTS_COLLECTION_NAME = process.env.WF_EVENTS_COLLECTION_NAME || "Events";
const WF_EVENT_START_FIELD = process.env.WF_EVENT_START_FIELD || "event-start-date";
const WF_EVENT_END_FIELD = process.env.WF_EVENT_END_FIELD || "event-end-date";

let cachedCollectionId = null;

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

async function getEventsCollectionId() {
  if (cachedCollectionId) return cachedCollectionId;

  const data = await webflowFetch(`/v2/sites/${WF_SITE_ID}/collections`);
  const collections = data.collections || [];

  const collection = collections.find(
    (c) =>
      c.displayName === WF_EVENTS_COLLECTION_NAME ||
      c.slug === WF_EVENTS_COLLECTION_NAME.toLowerCase()
  );

  if (!collection) {
    throw new Error(`Collection not found: ${WF_EVENTS_COLLECTION_NAME}`);
  }

  cachedCollectionId = collection.id;
  return cachedCollectionId;
}

function toDateOnly(value) {
    if (!value) return "";
  
    // Handles strings like MM-DD-YYYY
    if (typeof value === "string") {
      const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (match) {
        const [, month, day, year] = match;
        return `${year}-${month}-${day}`;
      }
    }
  
    // Fallback for ISO-like values
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
  
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
  
    return `${year}-${month}-${day}`;
  }

function eachDateInRange(startDateStr, endDateStr) {
  const dates = [];
  if (!startDateStr) return dates;

  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${(endDateStr || startDateStr)}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return dates;

  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function isDateWithinRange(targetDate, startDate, endDate) {
  if (!targetDate || !startDate) return false;
  const effectiveEnd = endDate || startDate;
  return targetDate >= startDate && targetDate <= effectiveEnd;
}

function normalizeEvent(item) {
  const f = item.fieldData || {};

  const startDate = toDateOnly(f[WF_EVENT_START_FIELD]);
  const endDate = toDateOnly(f[WF_EVENT_END_FIELD]);

  return {
    id: item.id,
    title: f.name || "",
    slug: f.slug || "",
    startDate,
    endDate: endDate || startDate,
    image: f["main-image"]?.url || f["image"]?.url || "",
    location: f["location"] || "",
    startTime: f["start-time"] || "",
    endTime: f["end-time"] || "",
    price: f["price"] || "",
    excerpt: f["short-description"] || f["summary"] || "",
    url: f.slug ? `/events/${f.slug}` : "#",
  };
}

async function getAllLiveItems(collectionId) {
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await webflowFetch(`/v2/collections/${collectionId}/items/live`, {
      limit,
      offset,
      sortBy: "name",
      sortOrder: "asc",
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

export async function GET(request) {
  try {
    if (!WF_SITE_ID || !WF_API_TOKEN) {
      return Response.json(
        { error: "Missing WF_SITE_ID or WF_API_TOKEN environment variables." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const month = searchParams.get("month");

    if (!date && !month) {
      return Response.json(
        { error: "Missing required query param: date or month" },
        { status: 400 }
      );
    }

    const collectionId = await getEventsCollectionId();
    const items = await getAllLiveItems(collectionId);
    const events = items.map(normalizeEvent).filter((event) => event.startDate);

    if (date) {
      const filtered = events.filter((event) =>
        isDateWithinRange(date, event.startDate, event.endDate)
      );

      return Response.json({
        date,
        total: filtered.length,
        items: filtered,
      });
    }

    if (month) {
      const days = {};
      const monthPrefix = `${month}-`;

      events.forEach((event) => {
        const coveredDates = eachDateInRange(event.startDate, event.endDate);
        coveredDates.forEach((coveredDate) => {
          if (coveredDate.startsWith(monthPrefix)) {
            if (!days[coveredDate]) days[coveredDate] = 0;
            days[coveredDate] += 1;
          }
        });
      });

      return Response.json({
        month,
        days,
      });
    }

    return Response.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}