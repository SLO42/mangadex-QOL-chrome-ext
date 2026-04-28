const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const API_BASE = 'https://api.mangadex.org';
const BATCH_MAX = 100;
const CACHE_VERSION = 2;

const cacheKey = (id) => `manga:v${CACHE_VERSION}:${id}`;

async function getCached(ids) {
  const keys = ids.map(cacheKey);
  const stored = await chrome.storage.local.get(keys);
  const now = Date.now();
  const hits = {};
  const misses = [];
  for (const id of ids) {
    const entry = stored[cacheKey(id)];
    if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
      hits[id] = entry;
    } else {
      misses.push(id);
    }
  }
  return { hits, misses };
}

async function fetchMissing(ids) {
  if (ids.length === 0) return {};

  const result = {};
  const toStore = {};
  const fetchedAt = Date.now();

  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const batch = ids.slice(i, i + BATCH_MAX);
    const params = new URLSearchParams();
    batch.forEach((id) => params.append('ids[]', id));
    params.append('limit', String(batch.length));
    ['safe', 'suggestive', 'erotica', 'pornographic'].forEach((r) =>
      params.append('contentRating[]', r),
    );

    const res = await fetch(`${API_BASE}/manga?${params}`);
    if (!res.ok) {
      throw new Error(`MangaDex API ${res.status}`);
    }
    const json = await res.json();

    for (const m of json.data || []) {
      const tags = (m.attributes?.tags || [])
        .map((t) => ({
          name: t.attributes?.name?.en,
          group: t.attributes?.group || 'genre',
        }))
        .filter((t) => t.name);
      const entry = {
        tags,
        contentRating: m.attributes?.contentRating || 'safe',
        fetchedAt,
      };
      result[m.id] = entry;
      toStore[cacheKey(m.id)] = entry;
    }
  }

  if (Object.keys(toStore).length > 0) {
    await chrome.storage.local.set(toStore);
  }
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'LOOKUP_MANGA' || !Array.isArray(msg.ids)) {
    return false;
  }

  (async () => {
    try {
      const ids = [...new Set(msg.ids.filter((x) => typeof x === 'string'))];
      const { hits, misses } = await getCached(ids);
      const fresh = await fetchMissing(misses);
      sendResponse({ data: { ...hits, ...fresh } });
    } catch (err) {
      console.warn('[mdx-ext bg] lookup failed', err);
      sendResponse({ error: String(err?.message || err) });
    }
  })();

  return true;
});
