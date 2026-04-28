# MangaDex Latest-Listing Enhancer — Design

**Date:** 2026-04-27
**Status:** approved (verbal), v0.1 implementation in progress

## Goal

Augment the chapter rows on `https://mangadex.org/titles/latest` with **tags** and a **content-rating chip** so users can scan/skip without clicking through. Match the visual language of the chips already used on `/titles/recent`.

## Non-goals (v0.1)

- Other listing pages (home feed, follows, search). Designed for reuse but not enabled.
- Hover popovers, settings UI, or per-user filters. Out of scope.
- Backwards compatibility with non-Chromium browsers. Manifest V3, Chrome target.

## Architecture

Manifest V3 extension, vanilla JS, no build step.

```
mangadex-plugin/
├── manifest.json
├── src/
│   ├── content.js     # DOM observation + pill rendering
│   ├── background.js  # service worker; fetch + storage cache
│   └── styles.css
└── README.md
```

**Content script ↔ service worker** message protocol:

- Request: `{ type: "LOOKUP_MANGA", ids: string[] }`
- Response: `{ data: { [id]: { tags: string[], contentRating: string, fetchedAt: number } } }` or `{ error: string }`

Why split content + SW:
1. Service worker `host_permissions` insulates fetches from any future CORS tightening.
2. Centralized cache; future expansion to additional pages reuses one SW.

## Components (content script)

| Module | Responsibility |
|---|---|
| `scopeDetector` | Watches `pushState`/`replaceState`/`popstate`. Emits `enter`/`leave` when URL matches `/^\/titles\/latest(\/|\?|$)/`. |
| `rowScanner` | While scope active, `MutationObserver` on `document.body`. Finds anchors `a[href^="/title/"]` whose text content is non-empty (skips cover-image links). Extracts manga UUID. Dedupes via `dataset.mdxExt`. |
| `lookupQueue` | 100ms debounce. Batches manga IDs (max 100/batch — MangaDex API hard cap). Sends `LOOKUP_MANGA` to SW. |
| `pillRenderer` | Inserts pill row immediately after the title anchor: rating chip first, then up to 4 tag chips, then `+N` chip with full list in `title=`. |
| `teardown` | On scope leave: disconnect observer, clear pending queue. |

## Components (service worker)

| Module | Responsibility |
|---|---|
| `mangaCache` | `chrome.storage.local` wrapper. Key: `manga:{uuid}`. Value: `{ tags, contentRating, fetchedAt }`. TTL: 7 days. |
| `mangaFetcher` | Splits IDs into cached/missing. Calls `GET https://api.mangadex.org/manga?ids[]=...&limit=N` for missing. Stores results. Replies with merged data. |

## Data flow

1. Page loads or SPA-navigates to `/titles/latest` → `scopeDetector` fires `enter`.
2. `rowScanner` attaches observer, scans existing DOM, queues each new anchor's manga ID.
3. `lookupQueue` debounces 100ms, sends batch to SW.
4. SW: cache hits returned immediately; misses fetched in one API call (max 100 IDs/batch); results stored in `chrome.storage.local`.
5. SW responds with merged data.
6. `pillRenderer` inserts pills next to each anchor.
7. Subsequent page visits hit cache → no API calls within 7-day TTL.

## Caching

- TTL 7 days per entry. Tags + content rating change rarely; this trades a tiny staleness window for ~zero API load on repeat visits.
- No proactive eviction in v0.1. `chrome.storage.local` quota is 10 MB; each entry is ~200 bytes; that's room for ~50k cached manga before we'd need an LRU. Acceptable.

## Error handling

- API non-OK / network error → SW returns `{ error }`; content script logs `console.warn`, no pills rendered. Silent degradation; user sees the unmodified page.
- 429 rate limit → simple retry with `Retry-After` is **not** implemented in v0.1. The 100-ID batching keeps us well under any plausible limit. Add only if observed.
- Malformed manga response → defensive parsing (`m.attributes?.tags?.map(...)`); skip pills for that ID.
- SW termination mid-request → content script's `sendMessage` Promise rejects; treated as network error.

## Styling

Pill row appended after the title anchor with `display: inline-flex; gap: 4px`. Rating chip uses solid color:

| Rating | Color |
|---|---|
| `safe` | green `#2e7d32` |
| `suggestive` | amber `#ef6c00` |
| `erotica` | red `#c62828` |
| `pornographic` | dark red `#6a1b1a` |

Tag chips: muted gray with thin border. Sized small (font-size 11px, padding 1px 6px) to match site density.

## SPA navigation

MangaDex is a Vue SPA — no full reload between routes. We patch `history.pushState`/`replaceState` and listen for `popstate`. Content script is matched on `https://mangadex.org/*` (broad) and gated by `scopeDetector` so it does nothing on out-of-scope URLs.

## Future scope (designed-for, not built)

The `scopeDetector`'s URL pattern is the only thing that needs to change to enable additional pages (`/titles/follows/feed`, `/`). The row-detection heuristic (`a[href^="/title/"]` with non-empty text) is identical across these pages because they share row markup.

## Manual test plan

1. Load unpacked from `chrome://extensions` (Developer mode on).
2. Visit `https://mangadex.org/titles/latest`.
3. Verify pill row appears next to each manga title within ~1s of load.
4. Verify rating chip color matches the JSON's `contentRating`.
5. Verify tags match JSON; if >4, check `+N` chip's tooltip lists the rest.
6. Scroll / paginate; verify new rows get pills.
7. Reload page; verify pills appear immediately (cache hit, no network call to api.mangadex.org for repeat IDs — confirm in DevTools Network tab).
8. Navigate to `/titles/recent` (different page) and back; verify pills reappear without errors.

## Open questions / risks

- **Row anchor selector** (`a[href^="/title/"]` with non-empty text) is heuristic. If MangaDex's frontend changes such that the title link contains an `<img>` and text together, this still works (we filter on `textContent.trim().length > 0`). If they remove the title text from the link entirely, we'd need to revisit.
- **CSS specificity** vs. site styles. We use a `mdx-ext-*` class prefix and inject via content_script CSS, which loads after site CSS. Should be sufficient; if not, we add `!important` selectively rather than escalating specificity wars.
