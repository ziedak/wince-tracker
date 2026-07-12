# @wince/storage

Storage abstraction layer with durable queues, multi-strategy persistence, and cookie management.

## Overview

The storage package provides a robust persistence layer for analytics data with multiple storage backends, intelligent fallback strategies, and crash-safe event queuing.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│                                                              │
│  • Session state  • Identity management  • Event queuing     │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Storage Abstraction                           │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  MultiStorage — Fallback Chain                            │  │
│  │  • Tries localStorage → sessionStorage → cookie → memory  │  │
│  │  • Writes to all available backends                       │  │
│  │  • Reads from first backend with data                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  DurableQueue — IndexedDB Event Queue                     │  │
│  │  • Crash-safe event persistence                           │  │
│  │  • Automatic eviction (max 2000 events)                   │  │
│  │  • Ack-based cleanup                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Storage Backends                             │
│                                                                 │
│  ┌─────────────────┐  ┌────────────────────┐  ┌──────────────┐  │
│  │  LocalStore     │  │ SessionStore       │  │ CookieStore  │  │
│  │  (localStorage) │  │ (sessionStorage)   │  │ (Cookies)    │  │
│  └─────────────────┘  └────────────────────┘  └──────────────┘  │
│  ┌──────────────┐                                               │
│  │ MemoryStore  │  (Always available, no persistence)           │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Components

1. **MultiStorage**: Intelligent fallback chain across multiple storage backends
2. **DurableQueue**: IndexedDB-backed queue for crash-safe event delivery
3. **BaseStorage**: Base implementation with debounced writes and atomic operations
4. **CookieStore**: Cookie-based storage with automatic root domain detection

## Installation

```bash
npm install @wince/storage
```

## Usage

### Storage Backends

The package provides ready-to-use storage instances:

```typescript
import {
  LocalStore,
  SessionStore,
  CookieStore,
  MemoryStore,
  createMultiStorage
} from '@wince/storage';

// LocalStorage — persists across browser sessions
const local = LocalStore();
local.set('user_id', '12345');
const userId = local.get<string>('user_id'); // '12345'

// SessionStorage — cleared when tab closes
const session = SessionStore();
session.set('temp_data', { foo: 'bar' });

// MemoryStore — in-memory only, lost on page refresh
const memory = MemoryStore();
memory.set('cache_key', 'value');

// CookieStore — persists in cookies, works across subdomains
const cookies = CookieStore({
  crossSubdomain: true,
  secure: true,
  sameSite: 'Lax',
  maxAgeDays: 365
});
cookies.set('anon_id', '550e8400-e29b-41d4-a716-446655440000');
```

#### CookieStore Configuration

```typescript
const cookieStore = CookieStore({
  crossSubdomain: true,   // Set cookie on root domain (.example.com)
  secure: true,           // Add Secure flag (HTTPS only)
  sameSite: 'Lax',        // SameSite attribute: 'Lax' | 'Strict' | 'None'
  maxAgeDays: 365         // Cookie expiration in days
});
```

#### Root Domain Detection

The `CookieStore` automatically detects the registrable root domain for cross-subdomain cookies:

```typescript
import { getRootDomain, resetRootDomainCache } from '@wince/storage';

// Get root domain (e.g., "example.com" from "app.example.com")
const root = getRootDomain('app.example.com'); // "example.com"

// Force recalculation (useful in tests)
resetRootDomainCache();
```

### MultiStorage - Fallback Strategy

`MultiStorage` tries multiple storage backends with graceful fallback:

```typescript
import { createMultiStorage } from '@wince/storage';

// Create storage with specific strategies
const myStorage = createMultiStorage({
  strategies: ['localStorage', 'cookie', 'memory'],
  cookieOptions: {
    crossSubdomain: true,
    secure: true,
    sameSite: 'Lax',
    maxAgeDays: 365
  }
});

// Check availability
console.log('Available:', myStorage.isAvailable());
console.log('Strategies:', myStorage.availableStoreList());
/*
{
  "localStorage": true,
  "cookie": true,
  "memory": true
}
*/

// Use it like any storage
myStorage.set('key', 'value');
const value = myStorage.get<string>('key');

// Read/write across all available backends (writes fan out)
myStorage.set('shared_data', { id: '123' });
// Data is written to localStorage AND cookie AND memory
```

#### Custom Strategy Order

```typescript
// Prefer cookies for cross-subdomain identity
const identityStore = createMultiStorage({
  strategies: ['cookie', 'localStorage', 'memory']
});

// Session-only data (no cross-tab persistence)
const tempStore = createMultiStorage({
  strategies: ['sessionStorage', 'memory']
});

// Cookies only (e.g., for cookieless consent fallback)
const cookieOnly = createMultiStorage({
  strategies: ['cookie']
});
```

### Storage API

All storage implementations share the `IStorage` interface:

```typescript
interface IStorage {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(prefix?: string): void;
  flush(): void;
  isAvailable(): boolean;
  refreshKey(key: string, updater: (current: string | undefined | null) => string): void;
}
```

#### Basic Operations

```typescript
const store = LocalStore();

// Set value (auto-serialized)
store.set('user', { id: '123', name: 'John' });

// Get value (auto-deserialized)
const user = store.get<User>('user');

// Check existence
const exists = store.get('user') !== undefined;

// Delete key
store.delete('user');

// Clear all data
store.clear();

// Clear with prefix
store.clear('wince_'); // Clears all keys starting with "wince_"
```

#### Atomic Read-Modify-Write

For safe concurrent updates (e.g., cross-tab session management):

```typescript
// Safely update a value without losing concurrent changes
store.refreshKey('counter', (current) => {
  const currentValue = current ? parseInt(current) : 0;
  return String(currentValue + 1);
});

// Use case: session activity tracking
store.refreshKey('session_state', (current) => {
  const state = current ? JSON.parse(current) : {};
  return JSON.stringify({
    ...state,
    lastActiveAt: Date.now()
  });
});
```

#### Debounced Writes

`BaseStorage` debounces writes to reduce I/O operations:

```typescript
// These writes are batched and flushed after 16ms
for (let i = 0; i < 100; i++) {
  store.set(`key_${i}`, i);
}
// Only 1-2 actual storage writes occur

// Force immediate flush if needed
store.flush();
```

### DurableQueue - Crash-Safe Event Queue

`DurableQueue` uses IndexedDB to persist events across crashes and reloads:

```typescript
import { DurableQueue, PersistedEvent } from '@wince/storage';

const queue = new DurableQueue();

// Enqueue event (fire-and-forget)
const event: PersistedEvent = {
  eid: crypto.randomUUID(),
  payload: JSON.stringify({
    id: 'event_123',
    type: 'track',
    event_name: 'page_view',
    properties: { page: '/home' }
  }),
  enqueuedAt: Date.now()
};

queue.enqueue(event);

// Load pending events on startup (e.g., after crash)
const pendingEvents = await queue.loadPending();
console.log('Recovered events:', pendingEvents.length);
// Re-send these events through your transport

// Acknowledge successfully delivered events
await queue.ack(['event_123', 'event_456']);

// Check queue size
const size = await queue.size();
console.log('Pending events:', size);
```

#### Crash Recovery Pattern

```typescript
class EventManager {
  private queue = new DurableQueue();
  private transport: Transport;

  async initialize() {
    // Load any events that weren't delivered before crash
    const pending = await this.queue.loadPending();
    
    // Re-deliver them
    for (const event of pending) {
      try {
        const payload = JSON.parse(event.payload);
        await this.transport.send(payload);
        await this.queue.ack([event.eid]);
      } catch (error) {
        console.error('Failed to re-deliver event:', event.eid);
        // Will be retried on next startup
      }
    }
  }

  async trackEvent(event: TrackEvent) {
    // Persist first
    this.queue.enqueue({
      eid: event.id,
      payload: JSON.stringify(event),
      enqueuedAt: Date.now()
    });

    // Try to send immediately
    try {
      await this.transport.send(event);
      await this.queue.ack([event.id]);
    } catch (error) {
      // Will be retried on next startup
      console.error('Send failed, event queued for retry');
    }
  }
}
```

#### Queue Limits

The queue has a hard cap of 2000 events. When exceeded, oldest events are evicted:

```typescript
// Enqueue events...
for (let i = 0; i < 2100; i++) {
  queue.enqueue({
    eid: `event_${i}`,
    payload: JSON.stringify({ index: i }),
    enqueuedAt: Date.now() - i * 1000 // Older events first
  });
}

// First 100 events were evicted (2100 - 2000 = 100)
const size = await queue.size(); // 2000
```

## Advanced Usage

### Storage Lifecycle Management

```typescript
const store = LocalStore();

// Flush all pending writes
store.flush();

// Clear all wince-related data
store.clear('wince_');

// Migrate from cookieless to persistent storage
class AnalyticsClient {
  private memoryStore = MemoryStore();
  private persistentStore = LocalStore();
  
  async grantConsent() {
    // Migrate data from memory to localStorage
    const data = this.memoryStore.get('session');
    if (data) {
      this.persistentStore.set('session', data);
    }
    
    // Clean up memory store
    this.memoryStore.clear();
  }
}
```

### Cookie Domain Strategies

```typescript
import { CookieStore, getRootDomain } from '@wince/storage';

// Cross-subdomain (recommended for multi-subdomain apps)
const crossSubdomain = CookieStore({
  crossSubdomain: true  // Cookie set on .example.com
});

// Single domain only
const singleDomain = CookieStore({
  crossSubdomain: false  // Cookie set on app.example.com only
});

// Custom cookie options
const custom = CookieStore({
  crossSubdomain: true,
  secure: true,
  sameSite: 'Strict',
  maxAgeDays: 30
});
```

### PersistedEvent Structure

```typescript
interface PersistedEvent {
  eid: string;           // UUID v7 — unique event ID (primary key)
  payload: string;       // JSON-serialized event data
  enqueuedAt: number;    // Unix ms — used for age-based eviction
}

// Example payload structure
const event: PersistedEvent = {
  eid: '01952f23-7423-7d5f-b518-123456789abc',
  payload: JSON.stringify({
    id: '01952f23-7423-7d5f-b518-123456789abc',
    type: 'track',
    event_name: 'purchase',
    properties: {
      order_id: 'ORD-123',
      total: 99.99,
      currency: 'USD'
    },
    timestamp: 1709452800000,
    sid: '01952f23-7423-7d5f-b518-123456789def',
    seq: 42,
    anonymous_id: '01952f23-7423-7d5f-b518-123456789xyz'
  }),
  enqueuedAt: 1709452800000
};
```

## Complete Integration Example

Using storage with core and transport:

```typescript
import {
  SessionManager,
  IdentityManager,
  SequenceCounter
} from '@wince/core';
import { createClientTransport } from '@wince/transport';
import { LocalStore, DurableQueue } from '@wince/storage';
import type { TrackEvent, EventPriority } from '@wince/types';

// Create persistent store
const store = LocalStore();

// Create durable queue for crash recovery
const durableQueue = new DurableQueue();

// Initialize managers with persistence
const sessionManager = new SessionManager({
  idleTimeoutMs: 30 * 60 * 1000,
  maxDurationMs: 24 * 60 * 60 * 1000,
  store
});

const identity = new IdentityManager({ store });
const sequence = new SequenceCounter();

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
  onBatchDelivered: (ids) => {
    // Acknowledge delivered events in durable queue
    durableQueue.ack(ids);
  }
});

transport.start();

// Crash recovery on startup
async function recoverPendingEvents() {
  const pending = await durableQueue.loadPending();
  
  for (const persisted of pending) {
    try {
      const event = JSON.parse(persisted.payload) as TrackEvent;
      transport.send(event);
      await durableQueue.ack([persisted.eid]);
    } catch (error) {
      console.error('Failed to recover event:', persisted.eid);
    }
  }
}

recoverPendingEvents();

// Track events with durability
async function trackDurable(event: TrackEvent) {
  // Persist to durable queue first
  durableQueue.enqueue({
    eid: event.id,
    payload: JSON.stringify(event),
    enqueuedAt: Date.now()
  });

  // Try to send immediately
  transport.send(event);
}

// Track page view
trackDurable({
  id: crypto.randomUUID(),
  type: 'track',
  event_name: 'page_view',
  properties: { page: '/home' },
  priority: EventPriority.Normal,
  sid: sessionManager.getSid(),
  seq: sequence.next(),
  anonymous_id: identity.getAnonId(),
  timestamp: Date.now()
});

// Handle page unload
window.addEventListener('pagehide', () => {
  transport.drain();
  store.flush();
});
```

## API Reference

### IStorage Interface

```typescript
interface IStorage {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(prefix?: string): void;
  flush(): void;
  isAvailable(): boolean;
  refreshKey(key: string, updater: (current: string | undefined | null) => string): void;
}
```

### Pre-built Storage Instances

| Export | Description | Persistence |
|--------|-------------|-------------|
| `LocalStore` | MultiStorage with localStorage | Permanent |
| `SessionStore` | MultiStorage with sessionStorage | Tab lifetime |
| `MemoryStore` | Memory-only storage | Page lifetime |
| `CookieStore(opts?)` | Cookie-based storage | Configurable (default 365 days) |

### DurableQueue

#### Methods

| Method | Description |
|--------|-------------|
| `enqueue(event: PersistedEvent): void` | Add event to queue (fire-and-forget) |
| `loadPending(): Promise<PersistedEvent[]>` | Load all pending events for replay |
| `ack(eids: string[]): Promise<void>` | Remove acknowledged events from queue |
| `size(): Promise<number>` | Get current queue size |

#### Types

```typescript
interface PersistedEvent {
  eid: string;           // UUID v7 — primary key
  payload: string;       // JSON-serialized event
  enqueuedAt: number;    // Unix ms for eviction
}
```

### MultiStorage

#### Constructor Options

```typescript
interface CreateStoreOptions {
  strategies?: StoreKind[];  // Default: ['localStorage', 'sessionStorage', 'cookie', 'memory']
  cookieOptions?: Partial<CookieStoreOptions>;
}
```

#### Methods

| Method | Description |
|--------|-------------|
| `get<T>(key: string): T \| undefined` | Read from first available backend |
| `set(key: string, value: unknown): void` | Write to all available backends |
| `delete(key: string): void` | Delete from all backends |
| `clear(prefix?: string): void` | Clear all or prefix-matched keys |
| `flush(): void` | Flush pending writes |
| `isAvailable(): boolean` | Check if any backend is available |
| `availableStoreList(): Record<string, boolean>` | List all backends and their availability |
| `getStrategy(): StoreKind[]` | Get active storage strategies |
| `refreshKey(key, updater): void` | Atomic read-modify-write on all backends |

### CookieStore Options

```typescript
interface CookieStoreOptions {
  crossSubdomain: boolean;           // Default: true
  secure: boolean;                   // Default: auto-detect (HTTPS)
  sameSite: 'Lax' | 'Strict' | 'None'; // Default: 'Lax'
  maxAgeDays: number;                // Default: 365
}
```

### Utility Functions

```typescript
// Get registrable root domain for cross-subdomain cookies
getRootDomain(hostname: string): string

// Reset root domain cache (testing)
resetRootDomainCache(): void
```

## Configuration

### Storage Strategy Selection

#### Maximum Compatibility

```typescript
// Use everything available
const store = createMultiStorage({
  strategies: ['localStorage', 'sessionStorage', 'cookie', 'memory']
});
```

#### Privacy-First (Cookieless)

```typescript
// Avoid cookies for privacy compliance
const store = createMultiStorage({
  strategies: ['localStorage', 'sessionStorage', 'memory']
});
```

#### Session-Only

```typescript
// No persistence across tabs or reloads
const store = createMultiStorage({
  strategies: ['sessionStorage', 'memory']
});
```

#### Minimal Footprint

```typescript
// Single storage backend
const store = createMultiStorage({
  strategies: ['localStorage']
});
```

### Cookie Configuration

#### Development

```typescript
const devCookies = CookieStore({
  crossSubdomain: false,
  secure: false,  // Allow HTTP in development
  sameSite: 'Lax',
  maxAgeDays: 1   // Short expiration for testing
});
```

#### Production

```typescript
const prodCookies = CookieStore({
  crossSubdomain: true,   // Share across subdomains
  secure: true,           // HTTPS only
  sameSite: 'Lax',        // CSRF protection
  maxAgeDays: 365         // Long-lived identity cookies
});
```

#### GDPR/Consent Compliance

```typescript
// Start without cookies (cookieless mode)
let store = createMultiStorage({
  strategies: ['localStorage', 'sessionStorage', 'memory']
});

// Migrate to cookies after consent
function onConsentGranted() {
  const cookieStore = CookieStore({
    crossSubdomain: true,
    maxAgeDays: 365
  });
  
  store = createMultiStorage({
    strategies: ['localStorage', 'cookie', 'memory']
  });
}
```

## Best Practices

### Storage Selection

1. **Use LocalStore for persistent data**: Session IDs, user preferences, identities
2. **Use SessionStore for temporary data**: Form drafts, navigation state
3. **Use CookieStore for cross-subdomain data**: Anonymous IDs, consent flags
4. **Use MemoryStore as fallback**: Always include as last strategy

### Performance

1. **Batch writes**: Use `set()` multiple times, then `flush()` once
2. **Avoid large values**: Cookies have ~4KB limit, localStorage ~5-10MB
3. **Use prefix clearing**: `clear('prefix')` instead of deleting keys one-by-one
4. **Leverage debouncing**: BaseStorage automatically batches writes

### Data Safety

1. **Use DurableQueue for critical events**: Prevent data loss on crash
2. **Acknowledge delivered events**: Remove from queue after successful delivery
3. **Handle IndexedDB quota**: Queue silently drops on quota exceeded
4. **Serialize complex objects**: All values are JSON-serialized

### Privacy & Compliance

1. **Respect consent**: Don't use storage until consent is granted
2. **Provide clear mechanism**: Allow users to clear stored data
3. **Use appropriate expiration**: Match cookie maxAge to data sensitivity
4. **Avoid sensitive data**: Don't store PII unless explicitly required

## Browser Support

### Storage Backends

| Backend | Browser Support | Notes |
|---------|----------------|-------|
| localStorage | All browsers | ~5-10MB limit |
| sessionStorage | All browsers | Tab lifetime |
| cookies | All browsers | ~4KB per cookie |
| memory | All browsers | No persistence |
| IndexedDB | All modern browsers | Required for DurableQueue |

### Browser Quirks

```typescript
// Safari private mode — localStorage throws on set
const store = LocalStore();
store.isAvailable(); // false in private mode

// Incognito mode — storage available but cleared on close
const session = SessionStore();
session.isAvailable(); // true, but data lost on close

// Third-party cookie blocking — CookieStore may be unavailable
const cookies = CookieStore();
cookies.isAvailable(); // false if blocked
```

## Dependencies

- `@wince/types` — Type definitions and IStorage interface
- `@wince/utils` — Serialization utilities

## Testing

```bash
# Run storage tests
npx jest --config jest.config.ts packages/storage/tests/

# Run all tests
npx nx test storage

# Run with coverage
npx nx test storage --code-coverage
```

## License

Private — part of the Wince tracker monorepo.