# @wince/web Technical Notes

This document describes the browser SDK as it is implemented in `packages/web`. It focuses on the public API, the event shapes that reach the backend, the transport body format, and the worker path.

## Package Entry Points

- [packages/web/src/index.ts](../packages/web/src/index.ts) exports the full browser bundle.
- [packages/web/src/index.lite.ts](../packages/web/src/index.lite.ts) exports only the minimal client API.
- `index.ts` re-exports the full plugin set and worker integration.
- `index.lite.ts` intentionally excludes the auto-capture plugins.

## Public API

The main public entry points are:

- `init(config)` → returns a `WinceClient` that runs entirely on the main thread.
- `initWithWorker(config)` → returns a `WorkerClient` when `Worker` is available, otherwise falls back to `WinceClient`.
- `activatePlugins(client)` → mounts the default auto-capture plugins used by the browser bundle.

The client exposes the usual lifecycle methods:

- `track(name, props?, personProps?, options?)`
- `page(props?)`
- `identify(uid, traits?)`
- `reset()`
- `flush()`
- `close()`
- `diagnostics()`

## Client Architecture

### Shared base behavior

`BaseClient` is the shared base for the main-thread and worker-backed clients. It:

- stores the consent provider,
- creates a tab-scoped `window_id`,
- tracks dropped-event counters,
- gates transport startup until consent and enrichment are ready,
- keeps a short-lived dedupe cache for repeated identical events.

### Main-thread client

`WinceClient` builds `TrackEvent` objects on the main thread. It owns:

- the session manager,
- the identity manager,
- the sequence counter,
- the sampling filter,
- the transport instance,
- browser lifecycle listeners,
- optional first-party enrichment,
- optional pre-enrichment buffering.

### Worker-backed client

`WorkerClient` keeps the HTTP transport on the main thread, but offloads:

- session state,
- identity state,
- sequence generation,
- event enrichment,
- IndexedDB persistence.

The worker path exists so the SDK can continue using `navigator.sendBeacon` on unload while moving the heavier event bookkeeping off the main thread.

## Event Model

The canonical event schema is `TrackEvent` from [packages/core/src/lib/types.ts](../packages/core/src/lib/types.ts).

### Required fields

- `eid` — UUID v7 event ID.
- `seq` — per-session sequence number.
- `t` — event name.
- `ts` — capture timestamp in milliseconds.
- `sid` — session ID.
- `anon` — anonymous browser/device ID.

### Optional fields

- `uid` — identified user ID.
- `props` — event-specific properties.
- `$set` — person properties merged into the user record.
- `$set_once` — person properties written only if absent.
- `url` — document URL at capture time.
- `ref` — document referrer at capture time.
- `window_id` — tab-scoped ID.
- `pageview_id` — current page view ID.
- `prev_pageview_id` — previous page view ID for `$page_view` hops.
- `anon_prev` — previous anonymous ID after `reset()`.
- `offset` — added by transport at encode time.
- `schema_v` — added by transport at encode time.
- any additional forward-compatible fields.

`offset` and `schema_v` are transport concerns, not client concerns.

## Backend Body Format

The HTTP request body sent to the backend is a JSON envelope with this shape:

```json
{
  "sent_at": 1730000000000,
  "events": [
    {
      "eid": "...",
      "seq": 12,
      "t": "page_view",
      "ts": 1729999999000,
      "sid": "...",
      "anon": "...",
      "props": {"...": "..."},
      "offset": 1000,
      "schema_v": 1
    }
  ]
}
```

Implementation details from `packages/transport/src/lib/transport.ts`:

- `sent_at` is computed once per batch with `Date.now()`.
- Each event gets `offset = sent_at - ts`.
- Each event gets `schema_v = 1`.
- The internal `_priority` field is stripped before serialization.

When compression is enabled, the JSON payload is gzip-compressed before send.

## Transport Behavior

The transport uses three lanes:

- `critical` → one event per flush, immediate send.
- `high` → small batches with a short flush interval.
- `normal` → the default lane for clicks, page views, scroll signals, and most other events.

The lane is chosen from `_priority` on the event. The public `TrackOptions.priority` flag is the client-side way to request the higher-priority path.

Request behavior:

- `HttpSender` always sends `Content-Type: application/json`.
- `Content-Encoding: gzip` is added when compression is enabled.
- The HTTP request uses `keepalive` for bodies smaller than 51 KiB.
- Retries honor transient failures and `Retry-After` when present.

Unload behavior:

- `Transport.drain()` is called from the `pagehide` path.
- It prefers `navigator.sendBeacon` when available.
- The drain path sends critical events first, then high, then normal.
- The drain packer stays under the sendBeacon size budget and can emit at most two beacon passes.

## Consent, Storage, and Enrichment

### Consent

The browser client can use the global consent provider or a custom one. It also supports cookieless modes:

- `off` — normal persistent identity.
- `on_reject` — session-only identity until consent is granted, then migrate to persistent storage.
- `always` — never write persistent identity/session data.

### Storage

The main-thread client uses the storage backends from `packages/storage` with the configured preference order. The default order is:

1. localStorage
2. sessionStorage
3. cookie
4. memory

The worker path uses `DurableQueue` in IndexedDB plus `WorkerCache` for session and identity state.

### Enrichment

The enrichment flow uses a GET request to:

- `<enrichmentUrl>?anon=<anon>&session=<session>`

The response can contain:

- `uid`
- `$set`
- `$set_once`
- any additional properties, which are attached to the first eligible event as `props`

Events queued before enrichment finishes are buffered. The first non-`$identify` event after enrichment receives the one-shot enrichment props.

## Props by Event Source

`props` is the only part of the backend event body that changes substantially by plugin. The transport envelope stays the same; each event carries a freeform `props` object, and the auto-capture plugins stamp `$plugin_source` so the backend can attribute the origin of the signal.

### Manual SDK calls

- `track(name, props)` forwards the caller-provided `props` as-is.
- `page(props)` forwards the caller-provided `props` as-is, then the page plugin adds page-view metrics on top.
- `identify(uid, traits)` does not use `props`; person traits are sent in `$set` / `$set_once`.

### Page view events

`$page_view` is the most structured event emitted by the browser SDK.

On the initial page load, the event includes:

- `title` and `ref` from `WinceClient.page()`.
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` when present in `location.search`.
- `device_type` (`mobile`, `tablet`, or `desktop`).
- `screen_width_px` and `screen_height_px`.
- `referrer_type` (`direct`, `organic_search`, `social`, `internal`, `referral`, or `email` / `paid_search` when overridden by UTM medium).
- `navigation_type` when the Navigation Timing API provides it.
- `$session_resume` when `navigation_type === 'back_forward'`.
- `$plugin_source: 'pageView'`.

On later SPA navigations, the event includes the same navigation and device fields plus the previous-page metrics from `buildMetrics()` with a `$prev_` prefix, such as:

- `$prev_scroll_depth_pct`
- `$prev_max_scroll_depth_pct`
- `$prev_scroll_px`
- `$prev_max_scroll_px`
- `$prev_content_height_px`
- `$prev_scroll_direction_changes`
- `$prev_scroll_max_velocity`
- `$prev_resize_count`
- `$prev_viewport_width_px`
- `$prev_viewport_height_px`
- `$prev_visible_time_ms`
- `$prev_time_on_page_ms`

When scroll milestone tracking is enabled, the plugin also emits `$scroll_depth` with:

- `depth_pct` set to `25`, `50`, `75`, or `100`.
- `$plugin_source: 'pageView'`.

### Click and interaction events

`mountClick()` emits `$click` with:

- `tag`
- `text`
- `elements_chain`
- any own properties collected from the click capture metadata
- `href` when the target is link-like
- `track_id` when the target carries `data-track`
- `has_modifier` when the click used a modifier key
- `label` when one of `data-track-label`, `aria-label`, `data-label`, or `title` is present
- `hesitation_ms` when the last mouse movement happened at least 500 ms before the click
- `$plugin_source: 'click'`

`mountRageClick()` emits `$rage_click` with:

- `tag`
- `text`
- `elements_chain`
- `count`
- `first_at`
- `href` when available
- `track_id` when available
- any own properties collected from the click capture metadata
- `$plugin_source: 'rageClick'`

`mountDeadClick()` emits `$dead_click` with:

- `tag`
- `text`
- `href`
- `track_id`
- `elements_chain`
- `elapsed_ms`
- `has_modifier`
- `$plugin_source: 'deadClick'`

`mountTextSelection()` emits `$text_selection` with:

- `selected_length`
- `context_element_tag`
- `context_track_id` when the selection is inside a `[data-track]` ancestor
- `$plugin_source: 'textSelection'`

### Cart events

`mountCart()` listens for `wince:cart` CustomEvents and forwards the `detail` payload as event properties, minus the `action` field itself. The emitted event name is `$cart_${action}`.

The cart plugin forwards these documented detail fields when present:

- `product_id`
- `name`
- `variant_id`
- `quantity`
- `price`
- `currency`
- `cart_id`
- `cart_value_total`
- `item_count`
- `coupon_code`
- `order_id`
- `revenue`
- `category`
- `stock_status`
- `step`
- `step_name`
- `option_name`
- `option_value`
- `code_attempted`
- `failure_reason`

Additional cart-derived fields are added by the plugin itself:

- `time_on_step_ms` on `$cart_checkout_step` when a previous checkout step exists.
- `last_step`, `cart_value_total`, `time_spent_seconds`, and `trigger` on `$cart_checkout_abandon`.
- `$plugin_source: 'cart'`.

High-value cart actions such as `add`, `remove`, `purchase`, `checkout_complete`, `coupon_applied`, and `coupon_failed` are routed to the higher-priority transport lane.

### Form events

`mountFormInteraction()` emits:

- `$form_start` with `form_id`, `form_name`, `form_action`, `field_name`, `field_type`, and `$plugin_source: 'formInteraction'`.
- `$form_field_focused` with `field_name`, `field_type`, and `$plugin_source: 'formInteraction'`.
- `$form_field_blurred` with `field_name`, `field_type`, optional `dwell_ms`, and `$plugin_source: 'formInteraction'`.
- `$form_frustration` with `field_name`, `field_type`, `focus_blur_count`, and `$plugin_source: 'formInteraction'`.

Payment-card and password fields are excluded from this plugin.

`mountValidationError()` emits `$validation_error` with:

- `field_name`
- `field_type`
- `form_id`
- `validation_message`
- `$plugin_source: 'validationError'`

### Error and performance events

`mountErrorCapture()` emits `$error` with:

- `type` (`uncaught` or `unhandled_rejection`)
- `message`
- `source` for uncaught errors
- `lineno`
- `colno`
- `stack` when available and not truncated away
- `$plugin_source: 'errorCapture'`

`mountPerformance()` emits `$performance` with:

- `lcp_ms`
- `cls_score`
- `inp_ms`
- `fcp_ms`
- `ttfb_ms`
- `dom_content_loaded_ms`
- `load_ms`
- `$plugin_source: 'performance'`

### Notes on forward compatibility

- The transport accepts arbitrary extra keys on each event, so plugin-specific props can evolve without changing the envelope.
- The backend should treat `props` as event-specific and plugin-specific rather than a single fixed schema.

## Browser Plugins

The full bundle exports the following plugin mounts from `packages/web/src/index.ts`:

- `mountPageView`
- `mountClick`
- `mountRageClick`
- `mountCart`
- `mountFormAbandon`
- `mountErrorCapture`
- `mountDeadClick`
- `mountCopyPaste`
- `mountExitIntent`
- `mountFormInteraction`
- `mountElementVisibility`
- `mountTabFocus`
- `mountTabIdle`
- `mountTextSelection`
- `mountNetworkQuality`
- `mountPerformance`
- `mountValidationError`
- `mountDoubleSubmit`
- `mountBacktrack`
- `mountIntervention`

The default automatic wiring only mounts page views and clicks.

### Page view plugin

`mountPageView()`:

- emits `$page_view` on mount,
- emits `$page_view` on `popstate` and `hashchange`,
- records `navigation_type` from the Navigation Timing entry and marks `$session_resume` for `back_forward`,
- captures UTM parameters from `location.search`,
- classifies referrers from `document.referrer` and `location.hostname`,
- records device type, screen dimensions, scroll depth, visibility time, and time-on-page metrics,
- emits `$scroll_depth` milestones at 25%, 50%, 75%, and 100% when milestone tracking is enabled,
- defers the first page view until the page is visible when `document.visibilityState !== 'visible'`,
- registers a before-drain hook so `$page_leave` is queued before `navigator.sendBeacon` drains the transport.

### Click plugin

`mountClick()`:

- tracks clicks on the allowed element set,
- captures text, label, href, `track_id`, modifier-key state, and hesitation timing,
- resolves labels from `data-track-label`, `aria-label`, `data-label`, and `title` in that order,
- ignores unsupported inputs and password/payment fields through the shared click utility.

## Worker Message Contract

The worker integration uses a small serialisable protocol.

### Main thread to worker

- `init`
- `track`
- `identify`
- `reset`
- `load_pending`
- `flush`
- `ack`
- `consent_change`
- `idb_size_request`

### Worker to main thread

- `enriched`
- `pending`
- `flush_ack`
- `idb_size_response`
- `identity_snapshot`
- `error`

The main thread forwards enriched events into the HTTP transport, while the worker persists them to IndexedDB for crash recovery.

## Files That Define the Contract

- [packages/web/src/client.ts](../packages/web/src/client.ts)
- [packages/web/src/index.ts](../packages/web/src/index.ts)
- [packages/web/src/index.lite.ts](../packages/web/src/index.lite.ts)
- [packages/web/src/worker/client.ts](../packages/web/src/worker/client.ts)
- [packages/web/src/worker/messages.ts](../packages/web/src/worker/messages.ts)
- [packages/web/src/plugins/pageView.ts](../packages/web/src/plugins/pageView.ts)
- [packages/web/src/plugins/click.ts](../packages/web/src/plugins/click.ts)
- [packages/transport/src/lib/transport.ts](../packages/transport/src/lib/transport.ts)
- [packages/core/src/lib/types.ts](../packages/core/src/lib/types.ts)