# Wince — Implementation Roadmap

> Living reference document. Update status as work lands.
>
> Legend: ✅ Done · 🔲 Not started · 🔧 In progress · ⏸ Deferred

---

## Current State (as of Phase 7)

| Package | Status | Notes |
|---------|--------|-------|
| `packages/compress` | ✅ | `compress()` async + `compressSync()` + `decompressSync()` |
| `packages/utils` | ✅ | Shared helpers |
| `packages/cache` | ✅ | LRU cache, doubly-linked list + Map, TTL |
| `packages/storage` | ✅ | IDB, localStorage, sessionStorage, cookie, memory; `DurableQueue` |
| `packages/consent` | ✅ | PENDING/DENIED/GRANTED, DNT, cookie-backed, onChange observers |
| `packages/core` | ✅ | `TrackEvent`, `Pipeline`, `SessionManager`, `IdentityManager`, `SequenceCounter`, `SamplingFilter`, UUID v7 |
| `packages/transport` | ✅ | `BatchQueue`, `Exporter`, `HttpSender` (keepalive), `BeaconClient`, circuit breaker, retry |
| `packages/observability` | ✅ | Logger, ConsoleSink |
| `packages/web` | ✅ | `WinceClient`, `init()`, `page()`, `identify()`, `reset()`, `optIn/Out()`, `flush()`, `close()`, pagehide/online/offline lifecycle |
| `packages/web` plugins | ✅ | `mountPageView`, `mountClick`, `mountCart` |
| `packages/web` worker | ✅ | `WorkerClient`, `tracker.worker.ts`, `initWithWorker()`, IDB-backed `WorkerCache`, fallback path |
| Sandbox | ✅ | Real `WinceLite.init()` demo with live event log |

**Known gaps carried forward:**
- No ack mechanism in DurableQueue (IDB events never pruned; server deduplicates by `eid`)
- `BatchQueue.requestId` not stamped (Phase 3 TODO)
- Bundle size limits are not enforced yet — size targets will be revisited once all features are implemented (see deferred section at end)

---

## Phase 8A — Core schema hardening
> **Unblocks:** backend Kafka schema agreement (ARCHITECTURE.md §5). Must land before Phase 8B.

### 8A-1 · `$window_id` on every event

**Why:** Multi-tab checkout flows produce two sessions with the same `anon` ID. Without a per-tab identifier the backend cannot separate "Tab 1: product page" from "Tab 2: checkout" — funnels collapse them into a single broken sequence.

**Where:** `packages/core`

**Implementation:**
- Add `window_id?: string` to `TrackEvent` interface (`types.ts`)
- `IdentityManager` generates and exposes `getWindowId(): string`
  - Stored in `sessionStorage` (tab-scoped, lost on tab close) under key `wince_wid`
  - Generated once per tab via UUID v4; never shared across tabs
- `WinceClient.track()` sets `raw.window_id = this._identity.getWindowId()`
- `WorkerClient`: include `window_id` in the `track` message from the main thread (DOM side) — `sessionStorage` is not accessible in Workers

---

### 8A-2 · `$pageview_id` chaining

**Why:** Core primitive for funnel analysis and drop-off attribution. Without it "user added to cart then left checkout" is structurally invisible to the backend.

**Where:** `packages/web` (`WinceClient`, `WorkerClient`, `plugins/pageView.ts`)

**Implementation:**
- Add `pageview_id?: string` and `prev_pageview_id?: string` to `TrackEvent`
- `WinceClient` holds `_pageviewId: string | undefined` in memory
- `page()` method:
  1. Sets `_prevPageviewId = _pageviewId`
  2. Generates `_pageviewId = uuidv7()`
  3. Includes both on the `$page_view` event
- All other `track()` calls attach the current `_pageviewId` (if any)
- `reset()` clears both IDs
- `WorkerClient`: main thread manages `_pageviewId` state; includes it in every `track` postMessage
- Plugin: `mountPageView` no longer needs to carry state — `WinceClient.page()` manages it internally

---

### 8A-3 · 24-hour session hard cap

**Why:** A user who leaves a tab open overnight accumulates a 24h+ session because each page interaction extends the idle timer. Backend queries group an entire day's activity into one funnel step.

**Where:** `packages/core` (`session.ts`, `SessionManagerOptions`)

**Implementation:**
- Add `maxDurationMs?: number` to `SessionManagerOptions` (default: `24 * 60 * 60_000`)
- `_isExpired(now)`: also returns `true` when `now - state.startedAt > maxDurationMs`
- No change to `TrackEvent` schema

---

### 8A-4 · Clock skew offset timestamps

**Why:** A device whose clock is 10 minutes fast emits events with future `ts` values. Backend sorts by `ts` and the funnel becomes `checkout_complete → add_to_cart` (backwards). Server-side correction requires knowing the client-to-server offset.

**Where:** `packages/transport` (`transport.ts` encode function)

**Implementation:**
- Add `sent_at: number` (unix ms) to the batch envelope, set at encode time: `Date.now()`
- Each event in the batch carries `offset: sent_at - event.ts` (signed integer ms)
- Backend: `corrected_ts = receive_time - offset`
- `TrackEvent` gets optional `offset?: number` field (set by Transport, not by caller)
- No change to the public `track()` API — purely internal enrichment at serialization

---

### 8A-5 · Schema version field

**Why:** IDB-replayed events from a previous SDK version will fail backend validation after a schema change. A version discriminator allows safe migration handling.

**Where:** `packages/core` (`types.ts`), `packages/transport` (`transport.ts`)

**Implementation:**
- Add `schema_v: number` to `TrackEvent` interface (value always `1` for now, set by Transport at encode time — not exposed in the public track API)
- `DurableQueue.PersistedEvent` gains `schema_v: number`; `loadPending()` filters out records whose `schema_v` is newer than the current SDK (forward-compatibility guard)
- On `onupgradeneeded` bump, a migration handler maps `schema_v: 1` records to `schema_v: 2` shape before opening the store (implements the ARCHITECTURE.md §1 "future note")

---

## Phase 8B — Cart-recovery signals
> Highest-value features for the cart-recovery use case. Depends on 8A schema changes.

### 8B-1 · Form abandonment plugin

**Why:** The most actionable cart-recovery signal: user filled `email` + shipping fields then closed the tab without submitting. No equivalent exists in PostHog or any general-purpose analytics SDK.

**Where:** `packages/web/src/plugins/formAbandon.ts` (new, tree-shakeable)

**API:**
```ts
const cleanup = mountFormAbandon(tracker, {
  // Fields to capture (opt-in). Defaults shown.
  captureFields: ['email', 'tel', 'name', 'address', 'city', 'zip'],
  // Never capture these regardless of name/type.
  excludeTypes:  ['password', 'hidden', 'credit-card'],
  // Minimum chars before a field is considered "filled".
  minLength: 2,
});
```

**Implementation:**
- On `pagehide` (before transport drain), scan `document.querySelectorAll('form')`:
  - For each form not `.submitted` (track via `submit` listener), collect filled fields
  - Emit `$form_abandon` with `{ form_id, form_action, fields_filled: ['email', 'address'], field_count, form_name }`
  - Never include field values — only field names and filled/empty status
- Track `submit` events to mark forms as submitted (suppress abandon for completed forms)
- Export `mountFormAbandon` from `packages/web/src/index.ts` (not `index.lite.ts`)

---

### 8B-2 · Unhandled error capture plugin

**Why:** A JS error during checkout (broken payment widget, null-deref on cart update) is the #1 reason for cart abandonment that can be directly fixed. Neither PostHog core nor Wince captures this automatically.

**Where:** `packages/web/src/plugins/errorCapture.ts` (new, tree-shakeable)

**API:**
```ts
const cleanup = mountErrorCapture(tracker, {
  captureUnhandledRejections: true,  // default
  captureWindowErrors:         true,  // default
  // Max stack trace length (chars). Default: 1024.
  maxStackLength: 1024,
  // Ignore errors matching these patterns.
  ignore: [/ResizeObserver loop/, /Non-Error promise rejection/],
});
```

**Implementation:**
- `window.addEventListener('error', handler)` → `tracker.track('$error', { message, source, lineno, colno, stack: stack.slice(0, maxStackLength), type: 'uncaught' })`
- `window.addEventListener('unhandledrejection', handler)` → `tracker.track('$error', { message, stack, type: 'unhandled_rejection' })`
- Dedup: maintain a seen-errors `LRUCache<string, true>` (key = `${message}:${lineno}`, maxSize: 20) — same error firing 100 times → captured once per session
- Export from `packages/web/src/index.ts`

---

### 8B-3 · `$set` / `$set_once` person property fields

**Why:** Currently `identify(uid)` is the only way to enrich a backend user profile. PostHog sends person properties alongside any event, halving the number of HTTP calls needed. For cart recovery emails, the person record must have `email` before the cart abandon signal — without `$set` this requires a separate identify call.

**Where:** `packages/core` (`types.ts`), `packages/web` (`client.ts`)

**Implementation:**
- Add to `TrackEvent`:
  ```ts
  $set?:      Record<string, unknown>;  // merged into person on every occurrence
  $set_once?: Record<string, unknown>;  // only set if key not already present on person
  ```
- Extend `identify()` signature:
  ```ts
  identify(uid: string, traits?: { $set?: Record<string, unknown>; $set_once?: Record<string, unknown> }): void
  ```
- Extend `track()` to accept person props:
  ```ts
  track(name: string, props?: Record<string, unknown>, personProps?: { $set?: ...; $set_once?: ... }): void
  ```
- `WinceClient` passes `$set`/`$set_once` through to `TrackEvent` without processing them — backend handles the merge

---

## Phase 8C — Production hardening ✅

### 8C-1 · Activity write throttle in `SessionManager` ✅

**Why:** On a checkout page with rapid interactions (keystroke-level events), `touch()` writes to localStorage on every call. 10 events/second = 10 storage writes/second. Browser RUM agents (Datadog, Sentry) fire a PerformanceObserver on every storage write, creating secondary spam. PostHog throttles to one write per 5 seconds.

**Where:** `packages/core` (`session.ts`)

**Implementation:**
- Add `private _lastSavedAt = 0` to `SessionManager`
- In `touch()`, only call `_save()` if `now - _lastSavedAt >= ACTIVITY_PERSIST_GRANULARITY_MS` (5000)
- `_startNew()` always saves immediately (session rotation must persist)
- `reset()` always saves immediately

---

### 8C-2 · Click capture hardening (sanitization layer) ✅

**Why:** Current `mountClick` has no text length cap (PII risk from long element labels) and captures clicks outside the safe-element whitelist (noise from custom components). Future behavioral plugins (rage-click, dead-click, hover-intent) must all go through the same sanitization — not implement their own.

**Architecture decision:** Option B — shared sanitization util, separate behavioral plugins.
- `mountClick` = capture + sanitize + emit `$click` (hardening lives here)
- Future `mountRageClick`, `mountDeadClick` etc. each attach their own `document.addEventListener('click')`, call the same `sanitizeClick()` util, then implement their own detection logic
- Each plugin is independently tree-shakeable; no shared singleton or EventBus needed
- `sanitizeClick()` running N times per click is negligible (single string comparison + attribute read)

**Where:** `packages/web/src/plugins/click.ts`, new `packages/web/src/plugins/_click-utils.ts`

**Changes:**
- Extract `sanitizeClick(event): ClickData | null` into `_click-utils.ts`:
  - Element whitelist: only process `a, button, input[type=submit], input[type=button], label, [role=button], [data-track]`
  - Text cap: `256` chars max on `innerText` extraction (down from current uncapped)
  - Returns `null` for: `type="password"`, `autocomplete` values matching `cc-*`, `current-password`, elements outside whitelist
- `mountClick` calls `sanitizeClick()` before emitting `$click`
- Rage-click detection moved to a separate task (see below)

**`ClickData` type** (exported from `_click-utils.ts`):
```ts
interface ClickData {
  tag: string;           // normalized tagName
  text: string;          // capped innerText
  href?: string;         // for <a>
  trackId?: string;      // data-track value
  attrs: Record<string, string>;  // data-track-* attrs
  target: EventTarget;
}
```

### 8C-2b · Rage-click plugin (separate task) ✅

**Where:** `packages/web/src/plugins/rageClick.ts` (new, tree-shakeable)

**Implementation:**
- `mountRageClick(tracker, options?)` attaches its own `document.addEventListener('click')`
- Calls `sanitizeClick(e)` from `_click-utils.ts`; skips if `null`
- Track `{ count, firstAt }` in a `WeakMap` keyed on element ref
- If 3+ clicks within 300ms → emit `$rage_click` with same `ClickData` props
- Clear entry after 500ms idle
- Export from `packages/web/src/index.ts` (not lite)

---

### 8C-3 · `onEventDropped` callback ✅

**Why:** The circuit breaker, rate limiter, consent gate, and sampling filter all silently discard events. Operators deploying Wince have no visibility into how many events are lost and why.

**Where:** `packages/web` (`WinceConfig`, `WinceClient`), `packages/transport` (`ExporterOptions`)

**Implementation:**
```ts
// WinceConfig addition
onEventDropped?: (reason: DropReason, event?: Partial<TrackEvent>) => void;

type DropReason =
  | 'consent'        // consent not granted
  | 'sampling'       // sampler returned false
  | 'rate_limit'     // token bucket exhausted
  | 'circuit_open'   // circuit breaker open
  | 'quota'          // server 429 quota signal
  | 'too_large'      // single event > server limit
  | 'buffer_full';   // maxBufferSize exceeded
```
- `WinceClient.track()` calls `onEventDropped('consent' | 'sampling')` for client-side drops
- `Exporter._sendBatch()` calls the hook for `circuit_open`, `quota`, `too_large`
- `BatchQueue.add()` calls it for `buffer_full` (currently silently drops oldest)

---

### 8C-4 · DurableQueue ack mechanism ✅

**Why:** Without ack, every page load replays all IDB events. They carry the same `eid` so the server deduplicates them, but it generates unnecessary traffic and fills the DurableQueue up to the 2000-event cap.

**Where:** `packages/web` (`worker/client.ts`, `worker/tracker.worker.ts`), `packages/transport`

**Implementation:**
- `WorkerClient` intercepts Transport's successful batch deliveries:
  - Wrap Transport's `fetch` with an interceptor that extracts `eid` values from the request body and, on HTTP 2xx, posts `{ type: 'ack', eids }` to the Worker
  - Worker calls `durableQ.ack(eids)`
- `Transport` gains an `onBatchDelivered?: (eids: string[]) => void` callback option
- The interceptor in `WorkerClient` extracts `eids` from the uncompressed batch before it's handed to `HttpSender`
- Fallback: without Worker, `WinceClient` never uses `DurableQueue` for now (IDB integration on main thread is Phase 9)

---

## Phase 8D — Reliability & engagement signals

### 8D-1 · Beacon capacity-aware packing ✅

**Why:** `sendBeacon` silently fails if the body exceeds 64 KB. With 200 queued events on a checkout page, the beacon almost certainly exceeds this. Currently `transport.drain()` sends everything; high-priority events (checkout, cart) may never get out if they're at the end of the buffer.

**Where:** `packages/transport` (`transport.ts`, `Exporter.drain()`)

**Implementation:**
- `drain()` accepts an optional `priorityFn?: (item: T) => number` (higher = more important)
- Before packing, sort buffer by priority descending
- Pack events greedily until `JSON.stringify(batch).length >= 60_000` (conservative threshold below 64 KB)
- Send first beacon with highest-priority events; if anything remains, attempt a second beacon
- `WinceClient._attachListeners()` passes a priority function: `$checkout_complete` = 100, `$cart_*` = 80, `$form_abandon` = 90, all others = 10

---

### 8D-2 · Scroll depth + visibility metrics in page views ✅

**Why:** Scroll depth is the primary proxy for "did the user see the product / price / CTA?". Tab visibility distinguishes foreground browsing from a background tab left open. Both metrics are *page-scoped* — they reset on navigation and are attached to the *next* `$page_view` event, which makes `pageView.ts` the right owner.

**Architecture decision:** Both scroll depth and visibility live in `mountPageView` as opt-in flags. Separating them into independent plugins would require a cross-plugin coordination mechanism to attach data to the `$page_view` event — complexity that doesn't pay off here.

**Where:** `packages/web/src/plugins/pageView.ts`

**Updated API:**
```ts
mountPageView(tracker, {
  trackScrollDepth: true,   // default: true
  trackVisibility:  true,   // default: true
  trackTimeOnPage:  true,   // default: true
})
```

**Scroll depth implementation (`trackScrollDepth: true`):**
- Attach a throttled `scroll` listener (max once per 200ms via `requestAnimationFrame`)
- Track: `_maxScrollPct`, `_lastScrollPct` (ceil to avoid 99.5% rounding)
- On next `page()` call: attach `{ $prev_scroll_depth_pct, $prev_max_scroll_depth_pct }` to the new `$page_view` event

**Visibility implementation (`trackVisibility: true`):**
- Track `_visibleStart: number` (set when `visibilityState === 'visible'`)
- On `visibilitychange`: Hidden → accumulate `_visibleMs`; Visible → reset `_visibleStart`
- `$prev_visible_time_ms` and `$prev_time_on_page_ms` attached to the next `$page_view` event

**Shared behaviour:**
- All metrics are in-memory only (no storage); lost on hard refresh for non-SPAs (acceptable)
- On `pagehide`: snapshot all active metrics before transport drain
- `$prev_pageview_id` always included when 8A-2 is implemented (links metrics to the page they describe)

---

### 8D-4 · Network quality adaptation ✅

**Why:** On slow mobile networks (3G), the default 2s batch timeout and 20-event batch size are suboptimal. Larger, less frequent batches reduce connection overhead. On 2G, CPU cost of compression may exceed bandwidth savings for small payloads.

**Where:** `packages/web` (`client.ts`), `packages/transport` (`transport.ts`)

**Implementation:**
- On `init()`, read `navigator.connection?.effectiveType` (if available)
- Map to transport config overrides:
  | effectiveType | batchSize | batchTimeoutMs | compress |
  |---|---|---|---|
  | `4g` | 20 (default) | 2000 | true |
  | `3g` | 10 | 3000 | true |
  | `2g` | 5  | 5000 | false |
  | `slow-2g` | 3 | 8000 | false |
- Re-evaluate on `change` event of `navigator.connection` (dynamic updates during session)
- Fallback: use defaults if `navigator.connection` is unavailable

---

## Phase 9 — Operational observability

### 9-1 · `tracker.diagnostics()` — dead letter queue

```ts
interface WinceDiagnostics {
  eventsQueued:   number;   // in Transport buffer right now
  eventsSent:     number;   // delivered this session
  eventsDropped:  number;   // by reason
  droppedByReason: Record<DropReason, number>;
  circuitOpen:    boolean;
  idbQueueSize:   Promise<number>;  // DurableQueue pending count
  sessionId:      string;
  windowId:       string;
  anonId:         string;
}

tracker.diagnostics(): WinceDiagnostics
```

- `WinceClient` accumulates counters in memory; `onEventDropped` increments `droppedByReason`
- `WorkerClient` proxies `idbQueueSize` via a round-trip Worker message
- No external dependencies; purely observational

---

### 9-2 · Cross-tab write safety (per-key refresh)

**Why:** Two tabs calling `SessionManager.touch()` simultaneously write `lastActiveAt` to localStorage. The slower write clobbers the faster one. PostHog avoids this with a per-key "read–modify–write" refresh pattern.

**Where:** `packages/storage` (`LocalStore`), `packages/core` (`session.ts`)

**Implementation:**
- Add `refreshKey(key: string, updater: (current: unknown) => unknown): void` to `IStore` interface
- `LocalStore.refreshKey()`: reads fresh from `localStorage`, applies updater, writes back — all synchronous (localStorage is synchronous, so this is atomic within a JS turn)
- `SessionManager._save()` uses `refreshKey` for `lastActiveAt` only; `sid` and `startedAt` are written normally (new sessions should not be merged)

---

### 9-3 · Anonymous ID continuity across storage wipes

**Why:** When a user clears browser storage, they get a new `anon` ID. Their previous cart (associated with the old anon ID) is unrecoverable. If the old ID was set in an IDB record before the wipe, or on a subdomain cookie, a stitching attempt can recover it.

**Where:** `packages/core` (`identity.ts`), `packages/storage` (`DurableQueue`)

**Implementation:**
- `IdentityManager` maintains `_prevAnonIds: string[]` (max 3, persisted to IDB via a new `wince_anon_history` record)
- On `reset()` or new anon ID generation: push current anon ID to history before rotating
- New `TrackEvent` field: `anon_prev?: string` (only on the first event after a new anon ID is generated)
- Backend can use `anon_prev` to stitch cart history from the previous identity
- History record stored in DurableQueue's `meta` IDB store (persistent across storage wipes, survives localStorage/cookie clears)

---

## Phase 10 — Compliance & attribution

### 10-1 · `cookieless` consent mode

**Why:** Some EU deployments (Germany, France) require consent before any persistent storage. In `cookieless` mode, the SDK runs with session-scoped identity only (no persistent anon ID, no cross-session continuity) until consent is granted.

**Where:** `packages/consent`, `packages/web` (`WinceConfig`)

**Implementation:**
```ts
interface WinceConfig {
  cookieless?: 'off' | 'on_reject' | 'always';
  // 'off'       — default, persistent anon ID always set
  // 'on_reject' — use session-only identity until GRANTED, then persist
  // 'always'    — never write to localStorage/cookie (session memory only)
}
```
- `IdentityManager` checks `cookieless` config before persisting anon ID
- `SessionManager` checks before persisting session state
- Consent change (`GRANTED`) in `on_reject` mode triggers a one-time migration: write in-memory anon ID to persistent store

---

### 10-2 · First-party enrichment handshake

**Why:** When a user clicks a cart-recovery email link, the backend knows who they are and what was in their cart. The SDK on the landing page needs to receive this context to immediately associate the session with the right user — without waiting for `identify()` to be called by the application.

**Where:** `packages/web` (`WinceConfig`, `client.ts`)

**Implementation:**
```ts
interface WinceConfig {
  enrichmentUrl?: string;
  // URL that returns a JSON object of session props to merge on init.
  // Example: 'https://api.mystore.com/wince/session-props'
  // The SDK sends: GET enrichmentUrl?anon=<anonId>&session=<sessionId>
  // Expected response: { uid?: string, $set?: {...}, utm_source?: string, ... }
  enrichmentTimeoutMs?: number;  // default: 1500 — don't block SDK startup
}
```
- On `init()` (async path, after consent check):
  1. Fire GET request to `enrichmentUrl` with `anon` + `session` query params
  2. On success within `enrichmentTimeoutMs`: merge response into pipeline as initial props
  3. If response includes `uid`: auto-call `identify(uid)`
- Queue starts paused during enrichment; `start()` called after enrichment resolves or times out
- The `$set` and `$set_once` fields from the enrichment response are included on the first event

---

### 10-3 · Persistence debounce + write no-op detection

**Why:** High-frequency event pages cause `LocalStore.set()` to fire hundreds of times per second. RUM monitoring agents (Datadog, Sentry browser SDK) attach a `PerformanceObserver` to `localStorage` mutations, causing secondary event spam.

**Where:** `packages/storage` (`LocalStore`, `SessionStore`)

**Implementation:**
- `LocalStore` gains a `_pendingWrites: Map<string, string>` buffer and a `_flushTimer`
- `set(key, value)`: update `_pendingWrites`; arm `_flushTimer` (default 16ms, `requestIdleCallback` if available)
- `_flush()`: write all pending entries to `localStorage` in one synchronous batch
- Write no-op: before flushing, compare serialized value to current `localStorage` value; skip if identical
- `get()` reads from `_pendingWrites` first (in-memory, always fresh), then falls through to `localStorage`
- Force flush on `pagehide` (same as PostHog `beforeunload` force-flush)
- `debounceMs: number` exposed in `LocalStoreOptions` (default: 16)

---

## Phase 11 — Novel features (no SDK has these)

### 11-1 · Beacon capacity-aware priority packing *(see 8D-1)*

Already described in Phase 8D-1. Listed here as a cross-reference.

### 11-2 · Event client-side deduplication

**Why:** SPA frameworks with hot-reload or double-render bugs fire the same `track()` call twice in < 5ms. Both events have different `eid` values so the server can't deduplicate them easily.

**Where:** `packages/web` (`WinceClient`)

**Implementation:**
- Maintain `_recentEvents: LRUCache<string, true>` (from `packages/cache`), `maxSize: 50, ttlMs: 2000`
- Key: `${event.t}:${JSON.stringify(event.props)}` (type + props fingerprint)
- Before enqueuing: if key exists in cache → drop (call `onEventDropped('client_dedup')`)
- Does NOT deduplicate by content-hash across sessions — only within a 2s window

### 11-3 · Event schema migration in DurableQueue

**Why:** When `schema_v` bumps, replayed IDB events from an older SDK will fail backend validation.

**Where:** `packages/storage` (`DurableQueue`), `packages/core`

**Implementation:**
- `DurableQueue.loadPending()` returns `{ events: PersistedEvent[], stale: PersistedEvent[] }`
- `stale`: records whose `schema_v` < current SDK version
- A `migrateStaleBatch(stale, fromV, toV)` function in `packages/core` transforms old records
- Stale records that cannot be migrated are acked (deleted) and reported via `onEventDropped('schema_mismatch')`

### 11-4 · Adaptive batch frequency from event velocity

**Why:** During rapid checkout interactions (form fill, address validation), batch more aggressively to reduce data loss on abandon. During idle browsing, batch less frequently to save battery.

**Where:** `packages/transport` (`Exporter`)

**Implementation:**
- `Exporter` tracks `_eventVelocity: number` (events per second, exponential moving average)
- `_armFlushTimer()` sets interval based on velocity:
  | velocity | flushIntervalMs |
  |---|---|
  | > 5/s | 500ms |
  | 1–5/s | 1000ms |
  | < 1/s | base (configurable, default 2000ms) |
- Velocity computed from `enqueue()` call timestamps; decays toward 0 when idle

### 11-5 · `$error` context on events near crashes

**Why:** When `$error` fires (via `mountErrorCapture`), subsequent events in the same session are enriched with `$near_error: true` and `$error_id` (reference to the `$error` event's `eid`). This lets the backend identify the cart abandon events that followed a JS error — the clearest signal that the error caused the abandonment.

**Where:** `packages/web` (`client.ts`)

**Implementation:**
- `mountErrorCapture` exposes `setLastErrorEid(eid: string)` callback
- `WinceClient` holds `_lastErrorEid: string | undefined`; clears after 30s
- `track()`: if `_lastErrorEid` is set, adds `{ $near_error: true, $error_eid: _lastErrorEid }` to props

---

## Bundle size budget enforcement ⏸ Deferred

> **Not enforced until all features are implemented.** Size targets below are provisional and will be revised once the feature set is stable.

| Bundle | Last measured (gzip) | Provisional target | Status |
|--------|---------------------|--------------------|--------|
| `index.lite.esm.js` | 8.7 KB | TBD | ⏸ Deferred |
| `index.esm.js` | 9.9 KB | TBD | ⏸ Deferred |
| `tracker.worker.js` | 2.6 KB | TBD | ⏸ Deferred |

**When to address (after Phase 11):**
- Establish real-world targets based on final feature set
- Tree-shake `DurableQueue` and `IdbStore` from the non-Worker path (only needed in `tracker.worker.ts`)
- Investigate `getRootDomain` cookie discovery inclusion in lite bundle (should be lazy)
- Use rollup-plugin-visualizer: `ANALYZE=1 bun nx run @wince/web:build` → open `dist/visualizer-lite.html`
- Consider code-splitting Phase 8B+ plugins (form abandon, error capture) as async imports

---

## Testing checkpoints per phase

| Phase | Required before merging |
|-------|------------------------|
| 8A | `bun nx run-many -t test` green; `bun nx run-many -t typecheck` green |
| 8B | End-to-end: form abandon fires on real form; error capture fires on thrown error |
| 8C | `bun nx run-many -t test` green; lint clean |
| 8D | Manual: DevTools → Network → Offline → track → Online → verify flush |
| 9 | Unit: `diagnostics()` counters match actual drop events |
| 10 | Manual: enrichment handshake with mock server; cookieless mode blocks writes |
| 11 | Unit: dedup cache; velocity-based flush interval changes |

---

## Cross-cutting constraints

- **Zero circular dependencies** between packages. Dependency direction: `utils → cache → compress → storage → consent → core → transport → web`
- **`packages/web` never imports from framework packages** (React, Vue, Angular). Framework adapters are separate packages wrapping `packages/web`.
- **`packages/core` has no browser APIs** (`document`, `window`, `navigator`). Browser wiring is `packages/web` only.
- **Worker scripts have no `document` or `window` access**. DOM data (url, ref, title) must be captured on the main thread and included in Worker messages.
- **All new `TrackEvent` fields are optional** (backward compatible). Backend must handle absence gracefully.
- **Backend schema agreement required before shipping Phase 8A** (Kafka consumer must understand `window_id`, `pageview_id`, `offset`, `schema_v`).
