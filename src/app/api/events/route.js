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

    map[item.id] = {
      id: item.id,
      name: f.name || "",
      slug: f.slug || "",
      shortDescription: f["descripcion-corta"] || "",
      order: Number(f["orden-filtro"] || 0),
      icon: f["icono"]?.url || "",
      pinColor: f["pin-color"] || "",
      chipBgColor: f["chip-light-color"] || "",
      chipTextColor: f["chip-strong-color"] || ""
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

  const startDate = toDateOnly(f["fecha-de-inicio"]);
  const endDate = toDateOnly(f["fecha-de-final"]);

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

    if (!date && !month) {
      return Response.json(
        { error: "Missing required query param: date or month" },
        { status: 400 }
      );
    }

    const eventsCollectionId = await getEventsCollectionId();

    console.log("eventsCollectionId", eventsCollectionId);
    console.log("WF_BARRIOS_COLLECTION_ID", WF_BARRIOS_COLLECTION_ID || "(missing)");
    console.log("WF_CATEGORIAS_COLLECTION_ID", WF_CATEGORIAS_COLLECTION_ID || "(missing)");

    const [eventItems, barrioItems, categoriaItems, eventsCollectionDetails] = await Promise.all([
      getAllLiveItems(eventsCollectionId),
      WF_BARRIOS_COLLECTION_ID ? getAllLiveItems(WF_BARRIOS_COLLECTION_ID) : Promise.resolve([]),
      WF_CATEGORIAS_COLLECTION_ID ? getAllLiveItems(WF_CATEGORIAS_COLLECTION_ID) : Promise.resolve([]),
      getCollectionDetails(eventsCollectionId)
    ]);

    console.log("eventItems", eventItems.length);
    console.log("barrioItems", barrioItems.length);
    console.log("categoriaItems", categoriaItems.length);
    console.log("eventsCollectionDetails fields", eventsCollectionDetails?.fields?.length || 0);

    const barriosById = buildBarriosMap(barrioItems);
    const categoriasById = buildCategoriasMap(categoriaItems);

    const valorField = getFieldBySlug(eventsCollectionDetails, "valor");
    const tipoEventoField = getFieldBySlug(eventsCollectionDetails, "tipo-de-evento");

    console.log("valorField", valorField?.slug || "(not found)");
    console.log("tipoEventoField", tipoEventoField?.slug || "(not found)");

    const valorOptionsById = buildOptionMap(valorField);
    const tipoEventoOptionsById = buildOptionMap(tipoEventoField);

    const events = eventItems
      .map((item) =>
        normalizeEvent(item, {
          barriosById,
          categoriasById,
          valorOptionsById,
          tipoEventoOptionsById
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

          days[coveredDate].items.push({
            id: event.id,
            title: event.title || "",
            slug: event.slug || "",
            url: event.url || "#"
          });
        });
      });

      console.log("barriosById count", Object.keys(barriosById).length);
      console.log("categoriasById count", Object.keys(categoriasById).length);
      console.log("sample barrio keys", Object.keys(barriosById).slice(0, 5));
      console.log("sample categoria keys", Object.keys(categoriasById).slice(0, 5));
      console.log("sample barrio item", JSON.stringify(barrioItems[0], null, 2));
      console.log("sample categoria item", JSON.stringify(categoriaItems[0], null, 2));
      console.log("sample raw event barrio", eventItems[0]?.fieldData?.["barrio"]);
      console.log("sample raw event categoria", eventItems[0]?.fieldData?.["categoria-principal"]);

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