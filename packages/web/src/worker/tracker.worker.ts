/**
 * @wince/web — Web Worker entry point.
 *
 * Handles event enrichment (eid, seq, sid, anon, ts) and IndexedDB
 * persistence (DurableQueue). The HTTP transport and all DOM-access
 * stay on the main thread.
 *
 * Message protocol: see ./messages.ts
 *
 * Built as a self-contained IIFE by Rollup (dist/tracker.worker.js).
 */

import {
  SessionManager,
  IdentityManager,
  SequenceCounter,
  SamplingFilter,
  type PersonProps,
} from '@wince/core';
import { DurableQueue } from '@wince/storage';
import { WorkerCache } from './workerCache';
import type {
  MainToWorkerMsg,
  WorkerToMainMsg,
  WorkerConfig,
} from './messages';
import { EventPriority, TrackEventPayload } from '@wince/types';
import { uuidv7 } from '@wince/utils';
// ---------------------------------------------------------------------------
// Worker state (initialised by the 'init' message)
// ---------------------------------------------------------------------------

let session: SessionManager;
let identity: IdentityManager;
let seq: SequenceCounter;
let sampler: SamplingFilter | undefined;
let durableQ: DurableQueue;
let workerCache: WorkerCache | undefined; // kept for consent_change migration

// Near-error tracking: events within 30 s of a crash are tagged with $near_error context.
let _lastErrorEid: string | undefined;
let _lastErrorTimer: ReturnType<typeof setTimeout> | undefined;
let cookielessMode: WorkerConfig['cookieless'];

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function handleInit(config: WorkerConfig): Promise<void> {
  const cache = new WorkerCache();
  await cache.init();
  workerCache = cache;
  cookielessMode = config.cookieless;

  // Determine whether to use persistent storage for session/identity.
  // 'always' — never persist. 'on_reject' — skip until consent granted.
  const initialGranted = config.initialConsentGranted !== false;
  const useStore =
    config.cookieless !== 'always' &&
    (config.cookieless !== 'on_reject' || initialGranted);

  session = new SessionManager({
    idleTimeoutMs: config.sessionIdleTimeoutMs,
    maxDurationMs: config.sessionMaxDurationMs,
    store: useStore ? cache : undefined,
  });
  identity = new IdentityManager({ store: useStore ? cache : undefined });
  seq = new SequenceCounter();
  durableQ = new DurableQueue();

  if (config.sampleRate !== undefined && config.sampleRate < 1) {
    sampler = new SamplingFilter({ rate: config.sampleRate });
  }
}

// ---------------------------------------------------------------------------
// Event enrichment
// ---------------------------------------------------------------------------

function enrichEvent(
  name: string,
  props: Record<string, unknown> | undefined,
  url: string | undefined,
  ref: string | undefined,
  window_id: string | undefined,
  pageview_id: string | undefined,
  prev_pageview_id: string | undefined,
  personProps?: PersonProps,
): TrackEventPayload {
  session.touch();

  // Near-error context: tag events that fire within 30 s of an unhandled crash.
  const finalProps =
    name !== '$error' && _lastErrorEid
      ? { $near_error: true, $error_eid: _lastErrorEid, ...props }
      : props;

  const eid = uuidv7();
  const event: TrackEventPayload = {
    eid,
    seq: seq.next(),
    n: name,
    ts: Date.now(),
    sid: session.getSid(),
    anon: identity.getAnonId(),
    uid: identity.getUserId(),
    props: finalProps,
    $set: personProps?.$set,
    $set_once: personProps?.$set_once,
    url,
    ref,
    wid: window_id,
    pvid: pageview_id,
    prev_pvid: prev_pageview_id,
    anon_prev: identity.getAndClearAnonPrev(),
    priority: name === '$error' ? EventPriority.High : EventPriority.Normal,
  };

  // Record error EID so subsequent events can be tagged with $near_error.
  if (name === '$error') {
    _lastErrorEid = eid;
    if (_lastErrorTimer !== undefined) clearTimeout(_lastErrorTimer);
    _lastErrorTimer = setTimeout(() => {
      _lastErrorEid = undefined;
    }, 30_000);
  }

  return event;
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

async function handleMessage(msg: MainToWorkerMsg): Promise<void> {
  switch (msg.type) {
    case 'track': {
      // Sampling check (deterministic: keyed on anonymous ID)
      if (sampler && !sampler.shouldTrack(identity.getAnonId())) return;

      const event = enrichEvent(
        msg.name,
        msg.props,
        msg.url,
        msg.ref,
        msg.window_id,
        msg.pageview_id,
        msg.prev_pageview_id,
        { $set: msg.$set, $set_once: msg.$set_once },
      );

      // 1. Reply to main thread immediately — transport sends via HTTP.
      const reply: WorkerToMainMsg = { type: 'enriched', event };
      self.postMessage(reply);

      // 2. Persist to IndexedDB (fire-and-forget crash recovery).
      //    TODO: add ack mechanism so delivered events are pruned from IDB.
      durableQ.enqueue({
        eid: event.eid,
        payload: JSON.stringify(event),
        enqueuedAt: event.ts,
      });
      break;
    }

    case 'identify':
      identity.identify(msg.uid, { $set: msg.$set, $set_once: msg.$set_once });
      // If traits were provided, emit a $identify event so the backend
      // receives person properties — same behaviour as WinceClient.identify().
      if (msg.$set || msg.$set_once) {
        const event = enrichEvent(
          '$identify',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { $set: msg.$set, $set_once: msg.$set_once },
        );
        self.postMessage({ type: 'enriched', event } satisfies WorkerToMainMsg);
      }
      break;

    case 'reset':
      identity.reset();
      session.reset();
      seq.reset();
      // Clear near-error context so the new session is not tagged with the
      // previous user's error EID.
      if (_lastErrorTimer !== undefined) {
        clearTimeout(_lastErrorTimer);
        _lastErrorTimer = undefined;
      }
      _lastErrorEid = undefined;
      break;

    case 'load_pending': {
      try {
        const persisted = await durableQ.loadPending();
        const events: TrackEventPayload[] = persisted
          .map((p) => {
            try {
              return JSON.parse(p.payload) as TrackEventPayload;
            } catch {
              console.warn(
                `Failed to parse persisted event ${p.payload}, skipping`,
              );
              return null;
            }
          })
          .filter((item) => item !== null) as TrackEventPayload[];

        const reply: WorkerToMainMsg = { type: 'pending', events };
        self.postMessage(reply);
      } catch (err) {
        const reply: WorkerToMainMsg = {
          type: 'error',
          message: `load_pending failed: ${(err as Error).message}`,
        };
        self.postMessage(reply);
      }
      break;
    }

    case 'flush': {
      // All messages posted before this flush have already been processed
      // (JS Worker is single-threaded). Reply immediately so the main
      // thread knows all 'enriched' messages have been posted.
      const reply: WorkerToMainMsg = { type: 'flush_ack', seq: msg.seq };
      self.postMessage(reply);
      break;
    }

    case 'ack': {
      // Remove successfully delivered events from IDB so they aren't replayed.
      try {
        await durableQ.ack(msg.eids);
      } catch (err) {
        const reply: WorkerToMainMsg = {
          type: 'error',
          message: `ack failed: ${(err as Error).message}`,
        };
        self.postMessage(reply);
      }
      break;
    }

    case 'consent_change': {
      // For on_reject mode: migrate in-memory identity/session to persistent store.
      if (msg.granted && cookielessMode === 'on_reject' && workerCache) {
        identity.migrateToStore(workerCache);
        session.migrateToStore(workerCache);
      }
      break;
    }

    case 'idb_size_request': {
      try {
        const size = await durableQ.size();
        const reply: WorkerToMainMsg = {
          type: 'idb_size_response',
          seq: msg.seq,
          size,
        };
        self.postMessage(reply);
      } catch {
        const reply: WorkerToMainMsg = {
          type: 'idb_size_response',
          seq: msg.seq,
          size: 0,
        };
        self.postMessage(reply);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — buffer messages until 'init' is processed
// ---------------------------------------------------------------------------

let _initialized = false;
const _pending: MainToWorkerMsg[] = [];

(self as unknown as Worker).onmessage = async (
  e: MessageEvent<MainToWorkerMsg>,
) => {
  const msg = e.data;

  if (msg.type === 'init') {
    let initSucceeded = true;
    try {
      await handleInit(msg.config);
    } catch (err) {
      initSucceeded = false;
      const reply: WorkerToMainMsg = {
        type: 'error',
        message: `Worker init failed: ${(err as Error).message}`,
      };
      self.postMessage(reply);
    }

    if (!initSucceeded) return;

    _initialized = true;

    // Notify the main thread of the stable anon/session IDs so it can include
    // them in the first-party enrichment request (?anon=...&session=...).
    self.postMessage({
      type: 'identity_snapshot',
      anon: identity.getAnonId(),
      session: session.getSid(),
    } satisfies WorkerToMainMsg);

    // Drain buffered messages in arrival order
    const buffered = _pending.splice(0);
    for (const bufferedMsg of buffered) {
      await handleMessage(bufferedMsg);
    }
    return;
  }

  if (!_initialized) {
    _pending.push(msg);
    return;
  }

  await handleMessage(msg);
};
