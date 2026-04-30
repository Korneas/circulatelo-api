export const runtime = "nodejs";

const WF_SITE_ID = process.env.WF_SITE_ID;
const WF_API_TOKEN = process.env.WF_API_TOKEN;
const WF_BARRIOS_COLLECTION_ID = process.env.WF_BARRIOS_COLLECTION_ID;
const WF_CATEGORIAS_COLLECTION_ID = process.env.WF_CATEGORIAS_COLLECTION_ID;
const WF_CARACTERISTICAS_COLLECTION_ID = process.env.WF_CARACTERISTICAS_COLLECTION_ID;

const ESPACIOS_COLLECTION_NAME = "Espacios";
const PAGE_SIZE_DEFAULT = 18;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCollectionId = null;
let cachedItems = null;
let cachedRefs = null;
let cachedAt = 0;

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

async function getEspaciosCollectionId() {
  if (cachedCollectionId) return cachedCollectionId;
  const data = await webflowFetch(`/v2/sites/${WF_SITE_ID}/collections`);
  const collections = data.collections || [];
  const collection = collections.find(
    (c) =>
      c.displayName === ESPACIOS_COLLECTION_NAME ||
      c.slug === ESPACIOS_COLLECTION_NAME.toLowerCase()
  );
  if (!collection) throw new Error(`Collection not found: ${ESPACIOS_COLLECTION_NAME}`);
  cachedCollectionId = collection.id;
  return cachedCollectionId;
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
    const total = data.pagination?.total || 0;
    offset += limit;
    if (offset >= total || items.length === 0) break;
  }
  return allItems;
}

function buildBarriosMap(items) {
  const map = {};
  items.forEach((item) => {
    const f = item.fieldData || {};
    map[item.id] = {
      id: item.id,
      name: f.name || "",
      slug: f.slug || "",
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
      icon: f["icono"]?.url || "",
      pinColor: f["color-chip"] || "",
      chipBgColor: f["light-color"] || "",
      chipTextColor: f["chip---strong-color"] || "",
    };
  });
  return map;
}

function buildCaracteristicasMap(items) {
  const map = {};
  items.forEach((item) => {
    const f = item.fieldData || {};
    map[item.id] = {
      id: item.id,
      name: f.name || "",
      slug: f.slug || "",
      icon: f["icono"]?.url || "",
      tipo: f["tipo"] || "",
    };
  });
  return map;
}

function normalizeEspacio(item, refs) {
  const f = item.fieldData || {};
  const barrio = refs.barriosById[f["barrio"]] || null;
  const categoria = refs.categoriasById[f["categoria-principal"]] || null;

  const caracteristicaIds = Array.isArray(f["caracteristicas"]) ? f["caracteristicas"] : [];
  const caracteristicas = caracteristicaIds
    .map((id) => refs.caracteristicasById[id])
    .filter(Boolean);

  // fotos may be a single image or an array — handle both
  const fotos = f["fotos"];
  const coverImage = Array.isArray(fotos)
    ? (fotos[0]?.url || "")
    : (fotos?.url || "");

  return {
    id: item.id,
    title: f.name || "",
    slug: f.slug || "",
    url: f.slug ? `/espacios/${f.slug}` : "#",
    description: f["descripcion"] || "",
    image: coverImage,
    imageAlt: f.name || "",

    priceLevel: f["nivel-de-precio"] || null,
    priceMin: f["precio-minimo"] != null ? Number(f["precio-minimo"]) : null,
    priceMax: f["precio-maximo"] != null ? Number(f["precio-maximo"]) : null,

    googleMapsUrl: f["google-maps-url"] || "",
    instagramUrl: f["instagram-url"] || "",
    otherSocialUrl: f["otra-red-social"] || "",
    horarios: f["horarios"] || "",

    lat: f["latitud"] || "",
    lng: f["longitud"] || "",
    zona: f["zona"] || "",
    verified: !!f["verificado"],

    category: categoria?.name || "",
    categorySlug: categoria?.slug || "",
    categoryBgColor: categoria?.chipBgColor || "",
    categoryTextColor: categoria?.chipTextColor || "",

    neighborhood: barrio?.name || "",
    neighborhoodSlug: barrio?.slug || "",

    caracteristicas: caracteristicas.map((c) => ({
      name: c.name,
      slug: c.slug,
      icon: c.icon,
    })),
    caracteristicaSlugs: caracteristicas.map((c) => c.slug),

    featured: !!f["pautado"],
  };
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

async function getCachedData() {
    const now = Date.now();
    if (cachedItems && cachedRefs && now - cachedAt < CACHE_TTL_MS) {
      return { items: cachedItems, refs: cachedRefs };
    }
  
    const espaciosCollectionId = await getEspaciosCollectionId();
    
    // Promise.all must come BEFORE any reference to espacioItems
    const [
      espacioItems,
      barrioItems,
      categoriaItems,
      caracteristicaItems,
      espaciosCollectionDetails,
    ] = await Promise.all([
      getAllLiveItems(espaciosCollectionId),
      WF_BARRIOS_COLLECTION_ID ? getAllLiveItems(WF_BARRIOS_COLLECTION_ID) : Promise.resolve([]),
      WF_CATEGORIAS_COLLECTION_ID ? getAllLiveItems(WF_CATEGORIAS_COLLECTION_ID) : Promise.resolve([]),
      WF_CARACTERISTICAS_COLLECTION_ID
        ? getAllLiveItems(WF_CARACTERISTICAS_COLLECTION_ID)
        : Promise.resolve([]),
      getCollectionDetails(espaciosCollectionId),
    ]);
  
    // Debug logs go HERE — after Promise.all resolves
    console.log("espacioItems:", espacioItems.length);
    console.log("barrioItems:", barrioItems.length);
    if (espacioItems[0]) {
      console.log("Sample fieldData keys:", Object.keys(espacioItems[0].fieldData || {}));
      console.log("Sample fieldData:", JSON.stringify(espacioItems[0].fieldData, null, 2));
    }
  
    const nivelPrecioField = getFieldBySlug(espaciosCollectionDetails, "nivel-de-precio");
    const zonaField = getFieldBySlug(espaciosCollectionDetails, "zona");
    console.log("nivel-de-precio field found:", !!nivelPrecioField);
    console.log("zona field found:", !!zonaField);
  
    const refs = {
      barriosById: buildBarriosMap(barrioItems),
      categoriasById: buildCategoriasMap(categoriaItems),
      caracteristicasById: buildCaracteristicasMap(caracteristicaItems),
      nivelPrecioOptions: buildOptionMap(nivelPrecioField),
      zonaOptions: buildOptionMap(zonaField),
    };
  
    cachedItems = espacioItems;
    cachedRefs = refs;
    cachedAt = now;
    return { items: espacioItems, refs };
  }

function applyFilters(espacios, params) {
  const categorias = params.getAll("categoria").filter(Boolean);
  const priceLevels = params.getAll("priceLevel").filter(Boolean);
  const caracteristicasFilter = params.getAll("caracteristica").filter(Boolean);
  const search = (params.get("search") || "").trim().toLowerCase();

  return espacios.filter((e) => {
    if (categorias.length && !categorias.includes(e.categorySlug)) return false;

    if (priceLevels.length) {
      // Espacios without a price level are excluded when a price filter is active
      if (!e.priceLevel || !priceLevels.includes(e.priceLevel)) return false;
    }

    if (caracteristicasFilter.length) {
      const hasAll = caracteristicasFilter.every((slug) =>
        e.caracteristicaSlugs.includes(slug)
      );
      if (!hasAll) return false;
    }

    if (search) {
      const haystack = [
        e.title,
        e.description,
        e.neighborhood,
        e.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

function applySort(espacios, sort) {
  const sorted = [...espacios];
  switch (sort) {
    case "name-asc":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "name-desc":
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case "relevant":
    default:
      sorted.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (a.verified !== b.verified) return a.verified ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
  }
  return sorted;
}

export async function GET(request) {
  try {
    if (!WF_SITE_ID || !WF_API_TOKEN) {
      return Response.json(
        { error: "Missing WF_SITE_ID or WF_API_TOKEN" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      50,
      parseInt(searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT), 10)
    );
    const sort = searchParams.get("sort") || "relevant";
    const includeFacets = searchParams.get("facets") === "true";

    const { items, refs } = await getCachedData();
    const espacios = items.map((item) => normalizeEspacio(item, refs));
    const filtered = applyFilters(espacios, searchParams);
    const sorted = applySort(filtered, sort);

    const total = sorted.length;
    const start = (page - 1) * pageSize;
    const pageItems = sorted.slice(start, start + pageSize);
    const hasMore = start + pageSize < total;

    const response = { page, pageSize, total, hasMore, items: pageItems };

    if (includeFacets) {
      response.facets = {
        categorias: Object.values(refs.categoriasById).map((c) => ({
          slug: c.slug,
          name: c.name,
          count: espacios.filter((e) => e.categorySlug === c.slug).length,
        })),
        caracteristicas: Object.values(refs.caracteristicasById).map((c) => ({
          slug: c.slug,
          name: c.name,
          tipo: c.tipo,
          count: espacios.filter((e) => e.caracteristicaSlugs.includes(c.slug)).length,
        })),
      };
    }

    return Response.json(response);
  } catch (error) {
    console.error("ESPACIOS API ERROR", error);
    return Response.json(
      { error: error?.message || "Unknown error", stack: error?.stack || "" },
      { status: 500 }
    );
  }
}