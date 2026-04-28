(() => {
  'use strict';

  const SCOPE_PATTERN =
    /^\/(titles\/(latest|recent)\/?|search\/?|list\/[^/?]+\/?)?(\?.*)?$/;
  const EXCLUDE_PATTERN = /^\/titles\/follows\/feed/;
  const TITLE_HREF_PATTERN = /^\/title\/([0-9a-f-]{36})/i;
  const DEBOUNCE_MS = 100;
  const MAX_TAGS = 4;
  const RATING_LABEL = {
    safe: 'safe',
    suggestive: 'suggestive',
    erotica: 'erotica',
    pornographic: 'mature',
  };

  const inScope = () => {
    const path = location.pathname;
    if (EXCLUDE_PATTERN.test(path)) return false;
    return SCOPE_PATTERN.test(path);
  };

  const scopeDetector = (() => {
    let active = false;
    const enter = [];
    const leave = [];

    const check = () => {
      const now = inScope();
      if (now && !active) {
        active = true;
        enter.forEach((fn) => fn());
      } else if (!now && active) {
        active = false;
        leave.forEach((fn) => fn());
      }
    };

    const wrap = (method) => {
      const orig = history[method];
      history[method] = function (...args) {
        const result = orig.apply(this, args);
        queueMicrotask(check);
        return result;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', check);

    return {
      onEnter: (fn) => enter.push(fn),
      onLeave: (fn) => leave.push(fn),
      check,
    };
  })();

  const rowScanner = (() => {
    let observer = null;
    let onAnchor = null;

    const scan = (root) => {
      if (!root.querySelectorAll) return;
      const anchors = root.querySelectorAll('a[href^="/title/"]');
      for (const a of anchors) {
        if (a.dataset.mdxExt) continue;
        const href = a.getAttribute('href') || '';
        const m = TITLE_HREF_PATTERN.exec(href);
        if (!m) continue;
        const text = (a.textContent || '').trim();
        if (!text) continue;
        a.dataset.mdxExt = 'queued';
        onAnchor?.({ anchor: a, mangaId: m[1] });
      }
    };

    return {
      start: (callback) => {
        onAnchor = callback;
        scan(document.body);
        observer = new MutationObserver((records) => {
          for (const r of records) {
            r.addedNodes.forEach((n) => {
              if (n.nodeType === 1) scan(n);
            });
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
      stop: () => {
        observer?.disconnect();
        observer = null;
        onAnchor = null;
      },
    };
  })();

  let runtimeDead = false;
  const isRuntimeAlive = () => {
    if (runtimeDead) return false;
    if (!chrome.runtime?.id) {
      runtimeDead = true;
      console.info('[mdx-ext] extension reloaded — refresh the page to re-enable');
      return false;
    }
    return true;
  };

  function makeQueue(messageType, responseKey) {
    const pending = new Map();
    let timer = null;

    const resolveAllNull = (ids) => {
      for (const id of ids) {
        const cbs = pending.get(id);
        pending.delete(id);
        cbs?.forEach((cb) => cb(null));
      }
    };

    const flush = async () => {
      timer = null;
      const ids = [...pending.keys()];
      if (ids.length === 0) return;

      if (!isRuntimeAlive()) {
        resolveAllNull(ids);
        return;
      }

      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: messageType, ids });
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('Extension context invalidated')) {
          isRuntimeAlive();
          resolveAllNull(ids);
          return;
        }
        console.warn(`[mdx-ext] ${messageType} failed`, err);
        response = null;
      }

      const data = response?.[responseKey] || {};
      for (const id of ids) {
        const cbs = pending.get(id);
        pending.delete(id);
        cbs?.forEach((cb) => cb(data[id] ?? null));
      }
    };

    return {
      lookup: (id) =>
        new Promise((resolve) => {
          if (!pending.has(id)) pending.set(id, []);
          pending.get(id).push(resolve);
          if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
        }),
      clear: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending.clear();
      },
    };
  }

  const lookupQueue = makeQueue('LOOKUP_MANGA', 'data');
  const statusQueue = makeQueue('GET_STATUSES', 'statuses');

  const CHIP_BASE =
    'mdx-ext-pill inline-flex items-center gap-1 rounded uppercase' +
    ' text-[0.625rem] font-bold px-[0.375rem] leading-[1.5em] my-auto';

  const RATING_BG = {
    safe: 'bg-status-blue',
    suggestive: 'bg-status-orange',
    erotica: 'bg-status-red',
    pornographic: 'bg-status-red',
  };

  const TAG_GROUP_BG = {
    genre: 'bg-accent',
    theme: 'bg-accent',
    format: 'text-white bg-status-purple',
    content: 'text-white bg-status-red',
  };

  const pillRenderer = {
    render(anchor, data) {
      if (!data || anchor.dataset.mdxExtPills === 'rendered') return;
      anchor.dataset.mdxExtPills = 'rendered';

      const container = document.createElement('span');
      container.className = 'mdx-ext-pills flex flex-wrap gap-1 self-start';

      const rating = (data.contentRating || 'safe').toLowerCase();
      const ratingChip = document.createElement('span');
      ratingChip.className =
        `${CHIP_BASE} mdx-ext-rating mdx-ext-rating--${rating}` +
        ` text-white ${RATING_BG[rating] || RATING_BG.safe}`;
      ratingChip.textContent = RATING_LABEL[rating] || rating;
      ratingChip.title = `Content rating: ${rating}`;
      container.appendChild(ratingChip);

      const tags = Array.isArray(data.tags) ? data.tags : [];
      const visible = tags.slice(0, MAX_TAGS);
      for (const tag of visible) {
        const group = tag.group || 'genre';
        const groupBg = TAG_GROUP_BG[group] || TAG_GROUP_BG.genre;
        const chip = document.createElement('span');
        chip.className = `${CHIP_BASE} mdx-ext-tag mdx-ext-tag-group--${group} ${groupBg}`;
        chip.textContent = tag.name;
        container.appendChild(chip);
      }
      if (tags.length > MAX_TAGS) {
        const more = document.createElement('span');
        more.className = `${CHIP_BASE} mdx-ext-tag mdx-ext-tag--more bg-accent`;
        more.textContent = `+${tags.length - MAX_TAGS}`;
        more.title = tags.slice(MAX_TAGS).map((t) => t.name).join(', ');
        container.appendChild(more);
      }

      const titleEl = findTitleElement(anchor);
      if (titleEl && titleEl.parentElement) {
        titleEl.parentElement.insertBefore(container, titleEl.nextSibling);
      } else {
        anchor.appendChild(container);
      }
    },
  };

  const ROW_CONTAINER_SELECTORS = [
    '.chapter-feed__container', // /titles/latest, home feed
    '.manga-card', // /titles/recent (best-guess; will fall back to anchor if absent)
    '.manga-list-item',
  ];

  function findRowContainer(anchor) {
    for (const sel of ROW_CONTAINER_SELECTORS) {
      const el = anchor.closest(sel);
      if (el) return el;
    }
    return null;
  }

  const stripeRenderer = {
    apply(anchor, status) {
      if (anchor.dataset.mdxExtStripe === 'rendered') return;
      anchor.dataset.mdxExtStripe = 'rendered';
      if (!status) return;
      const safe = String(status).replace(/[^a-z_]/gi, '');
      const target = findRowContainer(anchor) || anchor;
      target.classList.add('mdx-ext-status', `mdx-ext-status--${safe}`);
    },
  };

  function findTitleElement(anchor) {
    const all = anchor.querySelectorAll('*');
    for (const el of all) {
      if (el.children.length > 0) continue;
      if (el.closest('svg, picture')) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 3) continue;
      return el;
    }
    return null;
  }

  const handleAnchor = ({ anchor, mangaId }) => {
    lookupQueue.lookup(mangaId).then((data) => {
      if (!anchor.isConnected) return;
      pillRenderer.render(anchor, data);
    });
    statusQueue.lookup(mangaId).then((status) => {
      if (!anchor.isConnected) return;
      stripeRenderer.apply(anchor, status);
    });
  };

  // ───── Auth (JWT discovery from localStorage) ─────────────────────

  function isJWTShape(s) {
    return (
      typeof s === 'string' &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)
    );
  }

  function decodeJWTPayload(jwt) {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) return null;
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64));
    } catch (e) {
      return null;
    }
  }

  function extractJWTs(value) {
    const found = [];
    const visit = (v) => {
      if (typeof v === 'string') {
        const matches = v.match(
          /[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
        );
        if (matches) {
          for (const m of matches) if (isJWTShape(m)) found.push(m);
        }
        if (v.startsWith('{') || v.startsWith('[')) {
          try {
            visit(JSON.parse(v));
          } catch (e) {}
        }
      } else if (Array.isArray(v)) {
        v.forEach(visit);
      } else if (v && typeof v === 'object') {
        Object.values(v).forEach(visit);
      }
    };
    visit(value);
    return found;
  }

  function findJWT() {
    // Fast path: oidc-client-ts user object stored under "oidc.user:<issuer>:<client>"
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('oidc.user:')) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        try {
          const data = JSON.parse(value);
          const token = data?.access_token || data?.id_token;
          if (token && isJWTShape(token)) {
            const payload = decodeJWTPayload(token);
            const now = Math.floor(Date.now() / 1000);
            if (!payload?.exp || payload.exp > now) {
              return token;
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // Fallback: heuristic scan of all localStorage values for JWT-shaped strings
    const candidates = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        if (!value) continue;
        for (const jwt of extractJWTs(value)) {
          candidates.push(jwt);
        }
      }
    } catch (e) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const scored = candidates
      .map((jwt) => ({ jwt, payload: decodeJWTPayload(jwt) }))
      .filter((c) => c.payload)
      .filter((c) => !c.payload.exp || c.payload.exp > now)
      .map((c) => {
        const claimsStr = JSON.stringify(c.payload).toLowerCase();
        let score = 0;
        if (claimsStr.includes('mangadex')) score += 10;
        if (c.payload.scope) score += 10; // strong access-token marker
        if (c.payload.azp) score += 1;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;
    if (scored[0].score < 10) return null;
    return scored[0].jwt;
  }

  async function syncToken() {
    const token = findJWT();
    if (!token) {
      console.info(
        '[mdx-ext] not logged in to MangaDex (no JWT found); library stripes disabled',
      );
      return;
    }
    const payload = decodeJWTPayload(token) || {};
    console.info(
      '[mdx-ext] auth token discovered',
      `(iss=${payload.iss}, scope=${payload.scope || '<none>'}, exp=${
        payload.exp ? new Date(payload.exp * 1000).toISOString() : '<none>'
      })`,
    );
    if (!isRuntimeAlive()) return;
    try {
      await chrome.runtime.sendMessage({ type: 'SET_TOKEN', token });
      console.info('[mdx-ext] auth token registered with service worker');
    } catch (err) {
      const msg = err?.message || String(err);
      if (!msg.includes('Extension context invalidated')) {
        console.warn('[mdx-ext] SET_TOKEN failed', err);
      }
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'REQUEST_TOKEN_REFRESH') {
      syncToken();
    }
    return false;
  });

  // ───── Wire up ────────────────────────────────────────────────────

  scopeDetector.onEnter(() => rowScanner.start(handleAnchor));
  scopeDetector.onLeave(() => {
    rowScanner.stop();
    lookupQueue.clear();
    statusQueue.clear();
  });

  syncToken().finally(() => scopeDetector.check());
})();
