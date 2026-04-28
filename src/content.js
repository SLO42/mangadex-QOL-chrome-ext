(() => {
  'use strict';

  const SCOPE_PATTERN = /^\/titles\/latest(\/|\?|$)/;
  const TITLE_HREF_PATTERN = /^\/title\/([0-9a-f-]{36})/i;
  const DEBOUNCE_MS = 100;
  const MAX_TAGS = 4;
  const RATING_LABEL = {
    safe: 'safe',
    suggestive: 'suggestive',
    erotica: 'erotica',
    pornographic: 'mature',
  };

  const scopeDetector = (() => {
    let active = false;
    const enter = [];
    const leave = [];

    const check = () => {
      const inScope = SCOPE_PATTERN.test(location.pathname);
      if (inScope && !active) {
        active = true;
        enter.forEach((fn) => fn());
      } else if (!inScope && active) {
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

  const lookupQueue = (() => {
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
        response = await chrome.runtime.sendMessage({
          type: 'LOOKUP_MANGA',
          ids,
        });
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('Extension context invalidated')) {
          isRuntimeAlive();
          resolveAllNull(ids);
          return;
        }
        console.warn('[mdx-ext] sendMessage failed', err);
        response = null;
      }

      const data = response?.data || {};
      for (const id of ids) {
        const cbs = pending.get(id);
        pending.delete(id);
        cbs?.forEach((cb) => cb(data[id] || null));
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(flush, DEBOUNCE_MS);
    };

    return {
      lookup: (mangaId) =>
        new Promise((resolve) => {
          if (!pending.has(mangaId)) pending.set(mangaId, []);
          pending.get(mangaId).push(resolve);
          schedule();
        }),
      clear: () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        pending.clear();
      },
    };
  })();

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
      if (!data || anchor.dataset.mdxExt === 'rendered') return;
      anchor.dataset.mdxExt = 'rendered';

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

  const handleAnchor = async ({ anchor, mangaId }) => {
    const data = await lookupQueue.lookup(mangaId);
    if (!anchor.isConnected) return;
    pillRenderer.render(anchor, data);
  };

  scopeDetector.onEnter(() => rowScanner.start(handleAnchor));
  scopeDetector.onLeave(() => {
    rowScanner.stop();
    lookupQueue.clear();
  });

  scopeDetector.check();
})();
