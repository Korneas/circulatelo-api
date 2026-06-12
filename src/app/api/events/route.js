export const runtime = "nodejs";

const WF_SITE_ID = process.env.WF_SITE_ID;
const WF_API_TOKEN = process.env.WF_API_TOKEN;
const WF_EVENTS_COLLECTION_NAME = process.env.WF_EVENTS_COLLECTION_NAME || "Events";
const WF_EVENT_START_FIELD = process.env.WF_EVENT_START_FIELD || "event-start-date";
const WF_EVENT_END_FIELD = process.env.WF_EVENT_END_FIELD || "event-end-date";
const WF_BARRIOS_COLLECTION_ID = process.env.WF_BARRIOS_COLLECTION_ID;
const WF_CATEGORIAS_COLLECTION_ID = process.env.WF_CATEGORIAS_COLLECTION_ID;
const WF_CATEGORY_BG_FIELD = process.env.WF_CATEGORY_BG_FIELD || "chip-light-color";
const WF_CATEGORY_TEXT_FIELD = process.env.WF_CATEGORY_TEXT_FIELD || "chip-strong-color";
const WF_CATEGORY_PIN_FIELD = process.env.WF_CATEGORY_PIN_FIELD || "pin-color";

// Fallback slugs used only if dynamic resolution can't find the date fields.
const DEFAULT_START_DATE_SLUG = "fecha-de-inicio";
const DEFAULT_END_DATE_SLUG = "fecha-de-final";

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

async function getCollectionDetails(collectionId) {
  return webflowFetch(`/v2/collections/${collectionId}`);
}

function getFieldBySlug(collectionDetails, slug) {
  const fields = collectionDetails?.fields || [];
  return fields.find((field) => field.slug === slug) || null;
}

// Webflow keeps a field's ORIGINAL api slug even after you rename it in the
// editor, so the label shown in the UI ("fecha-de-final") is not guaranteed to
// match the slug the API returns. Resolve the real slug from the collection's
// field definitions by finding the DateTime field whose name/slug reads like a
// start or end date, while ignoring the "pautado" promo dates. Falls back to
// the provided default if nothing matches.
function resolveDateFieldSlug(collectionDetails, includeTokens, fallbackSlug) {
  const fields = collectionDetails?.fields || [];
  const norm = (s) => String(s || "").toLowerCase();

  const match = fields.find((field) => {
    if (field.type !== "DateTime") return false;
    const haystack = `${norm(field.displayName)} ${norm(field.slug)}`;
    if (haystack.includes("pautado") || haystack.includes("promo")) return false;
    return includeTokens.some((token) => haystack.includes(token));
  });

  return match?.slug || fallbackSlug;
}

function buildOptionMap(field) {
  const map = {};
  const options = field?.validations?.options || [];

  options.forEach((option) => {
    map[option.id] = option.name;
  });

  return map;
}

function buildBarriosMap(items) {
  const map = {};

  items.forEach((item) => {
    const f = item.fieldData || {};

    map[item.id] = {
      id: item.id,
      name: f.name || "",
      slug: f.slug || "",
      zone: f["zona"] || ""
    };
  });

  return map;
}

function buildCategoriasMap(items) {
  const map = {};

  items.forEach((item) => {
    const f = item.fieldData || {};
    const key = item.id || item._id || "";

    if (!key) return;

    map[key] = {
      id: key,
      name: f.name || "",
      slug: f.slug || "",
      shortDescription: f["descripcion-corta"] || "",
      order: Number(f["orden-filtro"] || 0),
      icon: f["icono"]?.url || "",

      pinColor: f["color-chip"] || "",
      chipBgColor: f["light-color"] || "",
      chipTextColor: f["chip---strong-color"] || ""
    };
  });

  return map;
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

function normalizeEvent(item, refs = {}) {
  const f = item.fieldData || {};

  // Use the dynamically resolved slugs (falling back to the Spanish defaults).
  const startSlug = refs.startDateSlug || DEFAULT_START_DATE_SLUG;
  const endSlug = refs.endDateSlug || DEFAULT_END_DATE_SLUG;

  const startDate = toDateOnly(f[startSlug]);
  const endDate = toDateOnly(f[endSlug]);

  const barrioId = f["barrio"] || "";
  const categoriaId = f["categoria-principal"] || "";

  const barrio = refs.barriosById?.[barrioId] || null;
  const categoria = refs.categoriasById?.[categoriaId] || null;

  const rawValor = f["valor"] || "";
  const rawTipoEvento = f["tipo-de-evento"] || "";

  const resolvedValor = refs.valorOptionsById?.[rawValor] || "";
  const resolvedTipoEvento = refs.tipoEventoOptionsById?.[rawTipoEvento] || "";

  return {
    id: item.id,
    title: f.name || "",
    slug: f.slug || "",
    url: f.slug ? `/eventos/${f.slug}` : "#",

    startDate,
    endDate: endDate || startDate,

    description: f["descripcion"] || "",
    image: f["imagen-portada"]?.url || "",
    imageAlt: f.name || "",

    startTime: f["hora"] || "",
    endTime: "",

    // this is what should show in the UI
    value: resolvedValor || "",
    price: f["precio"] || resolvedValor || "",

    location: f["lugar"] || "",
    place: f["lugar"] || "",
    placeLink: f["link-del-lugar"] || "",

    // keep event type separate
    eventType: resolvedTipoEvento || "",

    // category pill should come from categoria-principal reference
    category: categoria?.name || "",
    categorySlug: categoria?.slug || "",
    categoryData: categoria,
    categoryBgColor: categoria?.chipBgColor || "",
    categoryTextColor: categoria?.chipTextColor || "",
    categoryPinColor: categoria?.pinColor || "",

    // barrio display
    neighborhood: barrio?.name || "",
    neighborhoodZone: barrio?.zone || "",
    neighborhoodData: barrio,

    featured: !!f["pautado"],
    featuredStart: toDateOnly(f["pautado-inicio"]),
    featuredEnd: toDateOnly(f["pautado-fin"]),
    priority: Number(f["prioridad-listado"] || 0),

    lat: f["latitud"] || "",
    lng: f["longitud"] || "",
    contact: f["contacto"] || "",

    // raw ids for debugging
    barrioId,
    categoriaPrincipalId: categoriaId,
    rawValor,
    rawTipoEvento,
    secondaryCategoryIds: Array.isArray(f["categorias-secundarias"])
      ? f["categorias-secundarias"]
      : []
  };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.priority || 0) - (a.priority || 0);
  });
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
    const debug = searchParams.get("debug");

    const eventsCollectionId = await getEventsCollectionId();

    // The fields debug view only needs the collection schema, so handle it
    // before we require a date/month and before fetching every item.
    if (debug === "fields") {
      const eventsCollectionDetails = await getCollectionDetails(eventsCollectionId);

      const startDateSlug = resolveDateFieldSlug(
        eventsCollectionDetails,
        ["inicio", "comienzo", "start"],
        DEFAULT_START_DATE_SLUG
      );
      const endDateSlug = resolveDateFieldSlug(
        eventsCollectionDetails,
        ["final", "fin", "termino", "end"],
        DEFAULT_END_DATE_SLUG
      );

      return Response.json({
        collectionId: eventsCollectionId,
        resolved: { startDateSlug, endDateSlug },
        fields: (eventsCollectionDetails.fields || []).map((field) => ({
          slug: field.slug,
          displayName: field.displayName,
          type: field.type
        }))
      });
    }

    if (!date && !month) {
      return Response.json(
        { error: "Missing required query param: date or month" },
        { status: 400 }
      );
    }

    const [eventItems, barrioItems, categoriaItems, eventsCollectionDetails] = await Promise.all([
      getAllLiveItems(eventsCollectionId),
      WF_BARRIOS_COLLECTION_ID ? getAllLiveItems(WF_BARRIOS_COLLECTION_ID) : Promise.resolve([]),
      WF_CATEGORIAS_COLLECTION_ID ? getAllLiveItems(WF_CATEGORIAS_COLLECTION_ID) : Promise.resolve([]),
      getCollectionDetails(eventsCollectionId)
    ]);

    const barriosById = buildBarriosMap(barrioItems);
    const categoriasById = buildCategoriasMap(categoriaItems);

    const valorField = getFieldBySlug(eventsCollectionDetails, "valor");
    const tipoEventoField = getFieldBySlug(eventsCollectionDetails, "tipo-de-evento");

    const valorOptionsById = buildOptionMap(valorField);
    const tipoEventoOptionsById = buildOptionMap(tipoEventoField);

    // Resolve the real date-field slugs from the collection schema so a
    // renamed field (whose api slug differs from its label) is still read.
    const startDateSlug = resolveDateFieldSlug(
      eventsCollectionDetails,
      ["inicio", "comienzo", "start"],
      DEFAULT_START_DATE_SLUG
    );
    const endDateSlug = resolveDateFieldSlug(
      eventsCollectionDetails,
      ["final", "fin", "termino", "end"],
      DEFAULT_END_DATE_SLUG
    );

    const events = eventItems
      .map((item) =>
        normalizeEvent(item, {
          barriosById,
          categoriasById,
          valorOptionsById,
          tipoEventoOptionsById,
          startDateSlug,
          endDateSlug
        })
      )
      .filter((event) => event.startDate);

    if (date) {
      const filtered = sortEvents(
        events.filter((event) =>
          isDateWithinRange(date, event.startDate, event.endDate)
        )
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

      // Push the FULL normalized event object into each day's items array.
      // This lets the calendar UI render full event cards from a single
      // /api/events?month=YYYY-MM request, with no additional per-day fetches.
      sortEvents(events).forEach((event) => {
        const coveredDates = eachDateInRange(event.startDate, event.endDate);

        coveredDates.forEach((coveredDate) => {
          if (!coveredDate.startsWith(monthPrefix)) return;

          if (!days[coveredDate]) {
            days[coveredDate] = {
              count: 0,
              items: []
            };
          }

          days[coveredDate].count += 1;
          days[coveredDate].items.push(event);
        });
      });

      return Response.json({
        month,
        days,
      });
    }

    return Response.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("EVENTS API ERROR", error);

    return Response.json(
      {
        error: error?.message || "Unknown error",
        stack: error?.stack || ""
      },
      { status: 500 }
    );
  }
}