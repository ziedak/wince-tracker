# Project Architecture

This workspace is an Nx monorepo for the Wince analytics SDK, its support libraries, and the playground app used to verify behavior end-to-end.

## Repository Layout

- `packages/core` defines the canonical event schema and the session, identity, sequence, sampling, and pipeline primitives.
- `packages/transport` owns batching, retry, compression, request encoding, and the unload/drain path.
- `packages/web` is the browser SDK. It builds the event payloads, wires browser lifecycle listeners, mounts auto-capture plugins, and optionally offloads enrichment and IndexedDB persistence to a worker.
- `packages/storage` provides the storage adapters used by session and identity persistence.
- `packages/consent` owns consent state and change notifications.
- `packages/compress`, `packages/cache`, `packages/utils`, and `packages/observability` provide supporting runtime utilities.
- `apps/playground` is the browser demo app.
- `apps/playground-e2e` contains the Playwright coverage for the playground and the browser signals it exposes.

## Runtime Layers

The SDK is split into three major layers:

1. `core` creates and enriches `TrackEvent` records with session, identity, sequencing, and sampling state.
2. `web` turns browser activity into events, handles consent and enrichment, and exposes the public browser API.
3. `transport` batches events into the backend request body and sends them over HTTP or `navigator.sendBeacon`.

This separation keeps browser-specific concerns in `packages/web` and keeps request encoding, retry, and unload behavior in `packages/transport`.

## Main Data Flow

1. A browser interaction or SDK call enters `WinceClient` or `WorkerClient`.
2. The client builds a `TrackEvent` from the current session, anonymous ID, tab ID, page view ID, URL, and referrer state.
3. Optional enrichment is applied once to the first eligible event after init.
4. The event passes through the pipeline and any user-supplied `beforeTrack` hook.
5. The transport routes it to the correct batch lane based on priority.
6. The encoded request body is sent with fetch during normal operation or with `sendBeacon` on unload.

## Browser Bundle Shape

- `packages/web/src/index.ts` exports the full browser bundle, including the SDK, transport factory, worker integration, and all auto-capture plugins.
- `packages/web/src/index.lite.ts` exports the minimal client-only bundle.
- `activatePlugins(client)` in `packages/web/src/client.ts` mounts the default browser signals: page views and clicks.

## Build and Verification

- The workspace is managed by Nx and Bun.
- Package-level tests use Jest, and the web package uses `jsdom` for browser-style tests.
- The root `package.json` provides workspace-wide commands for linting, typechecking, tests, builds, and coverage collection.

## Source Files To Read First

- [packages/core/src/lib/types.ts](../packages/core/src/lib/types.ts)
- [packages/web/src/client.ts](../packages/web/src/client.ts)
- [packages/web/src/index.ts](../packages/web/src/index.ts)
- [packages/transport/src/lib/transport.ts](../packages/transport/src/lib/transport.ts)
- [packages/transport/src/lib/exporter.ts](../packages/transport/src/lib/exporter.ts)
- [packages/web/src/worker/client.ts](../packages/web/src/worker/client.ts)
