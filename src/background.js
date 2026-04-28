const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const API_BASE = 'https://api.mangadex.org';
const BATCH_MAX = 100;
const CACHE_VERSION = 2;

const LIBRARY_TTL_MS = 5 * 60 * 1000;
const LIBRARY_CACHE_KEY = 'library:status';
const TOKEN_KEY = 'auth:token';

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

async function getToken() {
  const stored = await chrome.storage.session.get(TOKEN_KEY);
  return stored[TOKEN_KEY] || null;
}

async function setToken(token) {
  if (token) {
    await chrome.storage.session.set({ [TOKEN_KEY]: token });
  } else {
    await chrome.storage.session.remove(TOKEN_KEY);
  }
}

async function fetchLibraryStatuses(token) {
  const res = await fetch(`${API_BASE}/manga/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`MangaDex API ${res.status}`);
  }
  const json = await res.json();
  return json.statuses || {};
}

async function getLibraryStatuses(senderTabId) {
  const stored = await chrome.storage.session.get(LIBRARY_CACHE_KEY);
  const cached = stored[LIBRARY_CACHE_KEY];
  const now = Date.now();
  if (cached && now - cached.fetchedAt < LIBRARY_TTL_MS) {
    return cached.statuses;
  }

  let token = await getToken();
  if (!token) return {};

  try {
    const statuses = await fetchLibraryStatuses(token);
    await chrome.storage.session.set({
      [LIBRARY_CACHE_KEY]: { statuses, fetchedAt: now },
    });
    return statuses;
  } catch (err) {
    if (err?.status === 401) {
      await setToken(null);
      if (senderTabId) {
        try {
          await chrome.tabs.sendMessage(senderTabId, {
            type: 'REQUEST_TOKEN_REFRESH',
          });
        } catch (e) {
          // tab may have closed
        }
      }
      return cached?.statuses || {};
    }
    console.warn('[mdx-ext bg] library fetch failed', err);
    return cached?.statuses || {};
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return false;

  if (msg.type === 'LOOKUP_MANGA' && Array.isArray(msg.ids)) {
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
  }

  if (msg.type === 'SET_TOKEN') {
    (async () => {
      await setToken(msg.token || null);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'GET_STATUSES' && Array.isArray(msg.ids)) {
    (async () => {
      try {
        const all = await getLibraryStatuses(sender?.tab?.id);
        const result = {};
        for (const id of msg.ids) {
          result[id] = all[id] || null;
        }
        sendResponse({ statuses: result });
      } catch (err) {
        console.warn('[mdx-ext bg] status lookup failed', err);
        sendResponse({ statuses: {} });
      }
    })();
    return true;
  }

  return false;
});
