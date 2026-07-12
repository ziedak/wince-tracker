# @wince/core

Core primitives for user identity, session management, event enrichment, and sampling control.

## Overview

The core package provides essential building blocks for analytics tracking:

- **Pipeline**: Synchronous middleware chain for event enrichment and filtering
- **SessionManager**: Automatic session lifecycle management with cross-tab coordination
- **IdentityManager**: Anonymous and identified user ID management
- **SequenceCounter**: Monotonic per-session event sequencing
- **SamplingFilter**: Probabilistic event filtering with deterministic or random sampling

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                      Event Processing                         │
│                                                               │
│  Raw Event → Pipeline Enrichment → Sampling → Transport       │
│                    (core)           (core)    (transport)     │
└───────────────────────────────────────────────────────────────┘

Core Components:
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Pipeline   │  │    Session   │  │   Identity   │
│              │  │   Manager    │  │   Manager    │
│ • Enrich     │  │              │  │              │
│ • Filter     │  │ • Sid gen    │  │ • Anon ID    │
│ • Transform  │  │ • Idle track │  │ • User ID    │
│ • Middleware │  │ • Cross-tab  │  │ • Reset      │
└──────────────┘  └──────────────┘  └──────────────┘
       │                  │                  │
       │                  │                  │
       ▼                  ▼                  ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│   Sampling      │  │  Sequence    │  │   Person     │
│   Filter        │  │   Counter    │  │   Props      │
│                 │  │              │  │              │
│ • Rate ctrl     │  │ • Seq numbers│  │ • User attrs │
│ • Deterministic │  │ • Gap detect │  │ • Traits     │
│ • Probabilistic │  └──────────────┘  └──────────────┘
└─────────────────┘
```

## Installation

```bash
npm install @wince/core
```

## Usage

### Pipeline - Event Enrichment Chain

The Pipeline is a synchronous middleware pattern for processing events before they're sent to the transport layer.

```typescript
import { Pipeline } from '@wince/core';
import type { TrackEvent } from '@wince/types';

// Define enrichment hooks
function enrichSession(event: TrackEvent, sessionManager: any): TrackEvent {
  return {
    ...event,
    properties: {
      ...event.properties,
      sid: sessionManager.getSid(),
      seq: sessionManager.getSequence()
    }
  };
}

function enrichIdentity(event: TrackEvent, identityManager: any): TrackEvent {
  return {
    ...event,
    anonymous_id: identityManager.getAnonId(),
    user_id: identityManager.getUserId()
  };
}

function addTimestamp(event: TrackEvent): TrackEvent {
  return {
    ...event,
    timestamp: event.timestamp || Date.now()
  };
}

function redactSensitiveData(event: TrackEvent): TrackEvent {
  const { password, credit_card, ssn, ...safeProps } = event.properties || {};
  return {
    ...event,
    properties: safeProps
  };
}

// Create and configure pipeline
const pipeline = new Pipeline<TrackEvent>()
  .use(addTimestamp)
  .use((event) => enrichSession(event, sessionManager))
  .use((event) => enrichIdentity(event, identityManager))
  .use(redactSensitiveData);

// Process events through pipeline
const rawEvent: TrackEvent = {
  id: crypto.randomUUID(),
  type: 'track',
  event_name: 'form_submit',
  properties: {
    email: 'user@example.com',
    form_id: 'contact'
  }
};

const enrichedEvent = pipeline.run(rawEvent);

if (enrichedEvent) {
  transport.send(enrichedEvent);
} else {
  console.log('Event was dropped by pipeline');
}
```

### SessionManager - Session Lifecycle

The SessionManager automatically creates and manages user sessions with configurable timeouts and cross-tab synchronization.

```typescript
import { SessionManager } from '@wince/core';
import { LocalStore } from '@wince/storage';

// Create session manager with persistence
const sessionManager = new SessionManager({
  idleTimeoutMs: 30 * 60 * 1000,    // 30 minutes of inactivity
  maxDurationMs: 24 * 60 * 60 * 1000, // 24 hours max
  store: new LocalStore()           // Persist across page reloads
});

// Get current session ID (creates new session if needed)
const sid = sessionManager.getSid();
console.log('Session ID:', sid);

// Record user activity - extends session
function onUserActivity() {
  sessionManager.touch();
}

// Track on various user actions
document.addEventListener('click', onUserActivity);
document.addEventListener('scroll', onUserActivity);
document.addEventListener('keypress', onUserActivity);

// Reset session (e.g., on logout)
sessionManager.reset();

// Get session metadata
console.log('Session started:', new Date(sessionManager.startedAt));

// Check if session is active without triggering rotation
const currentSid = sessionManager.peekSid();

// Clean up
sessionManager.destroy();
```

#### Cross-Tab Session Coordination

```typescript
// SessionManager automatically synchronizes across browser tabs using:
// 1. BroadcastChannel for instant notifications
// 2. Storage events for fallback coordination

// All tabs share the same session ID without manual coordination
const session1 = new SessionManager({ store: localStorage });
const session2 = new SessionManager({ store: localStorage });

// Both will have the same sid automatically
console.log(session1.getSid() === session2.getSid()); // true

// Activity in one tab resets idle timeout in all tabs
session1.touch(); // session2's idle timeout is also reset
```

### IdentityManager - User Identity

Manages anonymous device IDs and identified user IDs with persistence and identity stitching.

```typescript
import { IdentityManager } from '@wince/core';
import { CookieStore } from '@wince/storage';

// Create identity manager
const identity = new IdentityManager({
  store: new CookieStore() // Persist in cookies
});

// Get persistent anonymous ID (same across sessions)
const anonId = identity.getAnonId();
console.log('Anonymous ID:', anonId); // "550e8400-e29b-41d4-a716-446655440000"

// Identify a known user
identity.identify('user_12345', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'premium'
});

const userId = identity.getUserId();
console.log('User ID:', userId); // "user_12345"

// Reset identity (e.g., on logout)
identity.reset();

// The previous anonymous ID is available for identity stitching
const prevAnonId = identity.getAndClearAnonPrev();
console.log('Previous anon ID:', prevAnonId);
// Include this in the first event after reset to link old and new identities
```

#### Identity Stitching Pattern

```typescript
// When a user logs in, link anonymous and identified activities
function onUserLogin(userId: string, traits: PersonProps) {
  const prevAnonId = identity.getAndClearAnonPrev();
  
  // Send identify event with previous anonymous ID for stitching
  transport.send({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'identify',
    user_id: userId,
    anonymous_id: identity.getAnonId(),
    previous_anonymous_id: prevAnonId,
    traits: traits
  });
  
  identity.identify(userId, traits);
}
```

### SequenceCounter - Event Sequencing

Generates monotonic sequence numbers for detecting event gaps or duplicates.

```typescript
import { SequenceCounter } from '@wince/core';

// Create one counter per session
const sequence = new SequenceCounter();

// Assign sequence numbers to events
function trackEvent(eventName: string, properties: Record<string, any>) {
  transport.send({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'track',
    event_name: eventName,
    properties: properties,
    seq: sequence.next(), // Monotonically increasing: 0, 1, 2, 3...
    sid: sessionManager.getSid()
  });
}

// Usage
trackEvent('page_view', { page: '/home' });
trackEvent('button_click', { button: 'cta' });
trackEvent('form_view', { form: 'contact' });

// Sequence numbers: 0, 1, 2

// Current value without advancing
console.log('Next sequence will be:', sequence.current); // 3

// Reset when new session starts
sessionManager.onSessionReset(() => {
  sequence.reset(); // Back to 0
});

// The backend can detect:
// - Gaps: if seq 0, 1, 3 arrive (missing seq 2)
// - Duplicates: if seq 5 arrives twice
```

### SamplingFilter - Event Filtering

Probabilistic sampling to control event volume with deterministic or random selection.

```typescript
import { SamplingFilter } from '@wince/core';

// Create sampler - 10% of events
const sampler = new SamplingFilter({ rate: 0.1 });

// Random sampling (per-event, non-deterministic)
function shouldTrackRandom(): boolean {
  return sampler.shouldTrack();
}

// Deterministic sampling (same user always gets same result)
function shouldTrackUser(anonId: string): boolean {
  return sampler.shouldTrack(anonId);
}

// Usage in pipeline
const pipeline = new Pipeline<TrackEvent>()
  .use(addTimestamp)
  .use((event) => {
    // Drop 90% of events deterministically
    if (!sampler.shouldTrack(identity.getAnonId())) {
      return null; // Drop event
    }
    return event;
  })
  .use(enrichSession);

// Different sampling rates for different event types
const pageViewSampler = new SamplingFilter({ rate: 1.0 });   // 100%
const clickSampler = new SamplingFilter({ rate: 0.5 });      // 50%
const customEventSampler = new SamplingFilter({ rate: 0.1 }); // 10%

function trackEvent(name: string, props: Record<string, any>) {
  let samplerToUse;
  switch (name) {
    case 'page_view':
      samplerToUse = pageViewSampler;
      break;
    case 'click':
      samplerToUse = clickSampler;
      break;
    default:
      samplerToUse = customEventSampler;
  }
  
  if (!samplerToUse.shouldTrack(identity.getAnonId())) {
    return; // Skip event
  }
  
  transport.send({
    id: crypto.randomUUID(),
    type: 'track',
    event_name: name,
    properties: props,
    seq: sequence.next(),
    sid: sessionManager.getSid()
  });
}
```

## Complete Integration Example

Putting it all together:

```typescript
import {
  Pipeline,
  SessionManager,
  IdentityManager,
  SequenceCounter,
  SamplingFilter
} from '@wince/core';
import { createClientTransport } from '@wince/transport';
import { LocalStore } from '@wince/storage';
import type { TrackEvent, EventPriority } from '@wince/types';

// Initialize storage
const store = new LocalStore();

// Initialize managers
const sessionManager = new SessionManager({
  idleTimeoutMs: 30 * 60 * 1000,
  maxDurationMs: 24 * 60 * 60 * 1000,
  store
});

const identity = new IdentityManager({ store });
const sequence = new SequenceCounter();
const sampler = new SamplingFilter({ rate: 1.0 });

// Initialize transport
const transport = createClientTransport<TrackEvent>({
  url: 'https://api.example.com/v1/events',
  wsUrl: 'wss://api.example.com/ws',
  headers: { 'Authorization': 'Bearer API_KEY' },
  exporterOpts: { /* ... */ },
  compress: { enabled: true },
  maxBufferSize: 500,
  requestTimeoutMs: 10000,
  paused: false,
  onDropped: (reason) => console.warn('Event dropped:', reason),
  onBatchDelivered: (ids) => console.log('Delivered:', ids)
});

transport.start();

// Define pipeline enrichments
const pipeline = new Pipeline<TrackEvent>()
  .use((event) => {
    // Add timestamp
    return { ...event, timestamp: Date.now() };
  })
  .use((event) => {
    // Add session and sequence
    const sid = sessionManager.getSid();
    sessionManager.touch();
    return { ...event, sid, seq: sequence.next() };
  })
  .use((event) => {
    // Add identity
    const prevAnonId = identity.getAndClearAnonPrev();
    return {
      ...event,
      anonymous_id: identity.getAnonId(),
      user_id: identity.getUserId(),
      previous_anonymous_id: prevAnonId
    };
  })
  .use((event) => {
    // Apply sampling
    if (!sampler.shouldTrack(identity.getAnonId())) {
      return null; // Drop
    }
    return event;
  });

// Track function
function track(
  eventName: string,
  properties: Record<string, any>,
  priority: EventPriority = EventPriority.Normal
) {
  const event: TrackEvent = {
    id: crypto.randomUUID(),
    type: 'track',
    event_name: eventName,
    properties,
    priority
  };

  const enriched = pipeline.run(event);
  if (enriched) {
    transport.send(enriched);
  }
}

// Usage
track('page_view', { page: '/home' });
track('button_click', { button_id: 'cta' }, EventPriority.High);
track('purchase', { order_id: '123', total: 99.99 }, EventPriority.Critical);

// Handle user login
function login(userId: string, traits: PersonProps) {
  identity.identify(userId, traits);
  
  // Send identify event
  const prevAnon = identity.getAndClearAnonPrev();
  transport.send({
    id: crypto.randomUUID(),
    type: 'identify',
    user_id: userId,
    anonymous_id: identity.getAnonId(),
    previous_anonymous_id: prevAnon,
    traits,
    sid: sessionManager.getSid(),
    seq: sequence.next(),
    timestamp: Date.now()
  });
}

// Handle logout
function logout() {
  identity.reset();
  sessionManager.reset();
  sequence.reset();
}

// Clean up
window.addEventListener('pagehide', () => {
  transport.drain();
  sessionManager.destroy();
});
```

## API Reference

### Pipeline<T>

Synchronous middleware chain for event processing.

#### Methods

| Method | Description |
|--------|-------------|
| `use(hook: PipelineHook<T>): this` | Append a hook to the chain |
| `run(event: T): T \| undefined` | Process event through all hooks, or `undefined` if dropped |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `size` | `number` | Number of registered hooks |

#### Types

```typescript
type PipelineHook<T> = (event: T) => T | null | undefined;
```

### SessionManager

Manages user session lifecycle with persistence and cross-tab sync.

#### Constructor Options

```typescript
interface SessionManagerOptions {
  idleTimeoutMs?: number;  // Default: 30 minutes
  maxDurationMs?: number;  // Default: 24 hours
  store?: IStorage;        // Optional persistence
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `getSid(): string` | Get current session ID (starts new session if expired) |
| `peekSid(): string` | Get session ID without triggering rotation |
| `touch(): void` | Record activity, extend session |
| `reset(): void` | Force-start new session |
| `migrateToStore(store: IStorage): void` | Attach persistent store for consent |
| `destroy(): void` | Clean up listeners |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `startedAt` | `number` | Unix ms when session started |

### IdentityManager

Manages anonymous and identified user IDs.

#### Constructor Options

```typescript
interface IdentityManagerOptions {
  store?: IStorage; // Optional persistence
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `getAnonId(): string` | Get persistent anonymous device ID |
| `getUserId(): string \| undefined` | Get identified user ID |
| `identify(uid: string, traits?: PersonProps): void` | Associate user identity |
| `reset(): void` | Generate new anon ID, clear user ID |
| `getAndClearAnonPrev(): string \| undefined` | Get previous anon ID for stitching |
| `migrateToStore(store: IStorage): void` | Attach persistent store for consent |

### SequenceCounter

Monotonic counter for event sequencing.

#### Methods

| Method | Description |
|--------|-------------|
| `next(): number` | Get next sequence number |
| `reset(): void` | Reset counter to 0 |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `current` | `number` | Current counter value |

### SamplingFilter

Probabilistic event filtering.

#### Constructor Options

```typescript
interface SamplingOptions {
  rate: number; // 0.0 to 1.0
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `shouldTrack(seed?: string): boolean` | Check if event should be tracked |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `rate` | `number` | Sampling rate (0-1) |

## Configuration

### Session Timing

#### Short Sessions (e.g., Kiosk/Public Terminal)

```typescript
const session = new SessionManager({
  idleTimeoutMs: 5 * 60 * 1000,   // 5 minutes
  maxDurationMs: 30 * 60 * 1000   // 30 minutes
});
```

#### Standard Sessions

```typescript
const session = new SessionManager({
  idleTimeoutMs: 30 * 60 * 1000,  // 30 minutes
  maxDurationMs: 24 * 60 * 60 * 1000 // 24 hours
});
```

#### Long Sessions (e.g., Desktop App)

```typescript
const session = new SessionManager({
  idleTimeoutMs: 60 * 60 * 1000,   // 1 hour
  maxDurationMs: 7 * 24 * 60 * 60 * 1000 // 7 days
});
```

### Sampling Strategies

#### High Volume Sites (10% sample)

```typescript
const sampler = new SamplingFilter({ rate: 0.1 });
```

#### A/B Testing Cohorts

```typescript
// Use anonymous ID as seed for consistent cohort assignment
function getCohort(anonId: string): string {
  const hash = sampler.shouldTrack(anonId) ? 'treatment' : 'control';
  return hash;
}
```

#### Gradual Rollout

```typescript
// Gradually increase sampling from 10% to 100%
function getSamplingRate(feature: string): number {
  const rollout = {
    'new_feature': 0.1,
    'optimized_feature': 0.5,
    'stable_feature': 1.0
  };
  return rollout[feature] || 1.0;
}
```

## Best Practices

### Event Processing

1. **Always enrich in pipeline**: Add session ID, user ID, and timestamps in the pipeline, not in individual track calls
2. **Drop events explicitly**: Return `null` or `undefined` from pipeline hooks to filter events
3. **Order matters**: Place sampling early in the pipeline to avoid unnecessary enrichment work

### Session Management

1. **Persist sessions**: Use `LocalStore` or `CookieStore` in production
2. **Touch on activity**: Call `sessionManager.touch()` on meaningful user interactions
3. **Handle consent**: Use `migrateToStore()` when moving from cookieless to persistent storage
4. **Clean up**: Call `destroy()` when the client is closed

### Identity Management

1. **Persist anonymous ID**: Always use a store to maintain stable device identity
2. **Use previous_anonymous_id**: Include it in the first event after `identify()` for identity stitching
3. **Reset on logout**: Call `reset()` to break the link between device and user
4. **Respect privacy**: Don't store sensitive user traits unless necessary

### Sequencing

1. **One counter per session**: Create a new `SequenceCounter` when a session starts
2. **Reset with session**: Call `sequence.reset()` when `sessionManager.reset()` is called
3. **Include in all events**: Always add `seq: sequence.next()` to events

### Sampling

1. **Use deterministic mode**: Always pass user ID for consistent UX
2. **Configure per event type**: Different rates for page views, clicks, custom events
3. **Place early in pipeline**: Sample before expensive enrichment steps

## Dependencies

- `@wince/types` — Type definitions and interfaces
- `@wince/utils` — UUID generation, serialization utilities
- `@wince/storage` — LocalStore, CookieStore for persistence (optional)

## Browser Support

- Modern browsers with ES2020 support
- `BroadcastChannel` API (graceful degradation)
- `localStorage` or `cookies` for persistence

## Testing

```bash
# Run core tests
npx jest --config jest.config.ts packages/core/tests/

# Run all tests
npx nx test core

# Run with coverage
npx nx test core --code-coverage
```

## License

Private — part of the Wince tracker monorepo.