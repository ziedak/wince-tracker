# @wince/transport

High-performance transport layer for sending analytics events with priority-based batching, circuit breaking, and multiple transport protocols.

## Overview

The transport package provides a robust event delivery system with three priority lanes that route events based on urgency. It handles batching, rate limiting, retries with exponential backoff, circuit breaking, and compression to optimize network usage while ensuring critical events are delivered reliably.

### Architecture

```
┌──────────────┐
│  Client Code │  send(event)
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────┐
│                   Transport Layer                   │
│                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Critical  │  │     High    │  │    Normal   │  │
│  │     Lane    │  │    Lane     │  │    Lane     │  │
│  │             │  │             │  │             │  │
│  │ • Immediate │  │ • 2s flush  │  │ • Batched   │  │
│  │ • No batch  │  │ • Small     │  │ • Configure │  │
│  │ • Rate lim  │  │   batches   │  │   d batch   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │         │
│         └────────────────┼────────────────┘         │
│                          ▼                          │
│                  ┌──────────────────┐               │
│                  │  Event Sender    │               │
│                  │                  │               │
│                  │ • HTTP POST      │               │
│                  │ • Compression    │               │
│                  │ • Retry logic    │               │
│                  │ • Circuit breaker│               │
│                  └────────┬─────────┘               │
│                           │                         │
│           ┌───────────────┼───────────────┐         │
│           ▼               ▼               ▼         │
│    ┌────────────┐ ┌────────────┐ ┌────────────┐     │
│    │   HTTP     │ │  Beacon    │ │ WebSocket  │     │
│    │  Client    │ │  Client    │ │  Client    │     │
│    └────────────┘ └────────────┘ └────────────┘     │
└─────────────────────────────────────────────────────┘
```

### Priority Lanes

1. **Critical**: Events like `exit_intent`, `rage_click`, `checkout_complete` — sent immediately, never batched. Rate-limited to prevent storms.

2. **High**: Events like `purchase`, `form_abandon`, `cart_add` — small batches with 2-second flush interval.

3. **Normal**: Events like `scroll_depth`, `click`, `page_view` — standard batching with configurable size and interval.

### Transport Protocols

- **HTTP POST**: Primary protocol using `fetch` API with retry logic
- **Beacon**: Used for unload/drain scenarios via `navigator.sendBeacon`
- **WebSocket**: Real-time bidirectional communication (optional)

## Installation

```bash
npm install @wince/transport
```

## Usage

### Basic Setup

```typescript
import { Transport, createClientTransport } from '@wince/transport';
import type { TrackEventPayload, EventPriority } from '@wince/types';

// Define your event type
interface MyEvent extends TrackEventPayload {
  event_name: string;
  properties: {
    page: string;
    element?: string;
  };
}

// Create transport instance
const transport = createClientTransport<MyEvent>({
  url: 'https://api.example.com/v1/events',
  wsUrl: 'wss://api.example.com/ws',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY'
  },
  exporterOpts: {
    critical: {
      rateLimit: { maxTokens: 10, refillRateMs: 1000 },
      batch: { maxSize: 1, flushIntervalMs: 0 },
      retry: { maxAttempts: 3, baseDelayMs: 1000 }
    },
    high: {
      rateLimit: { maxTokens: 10, refillRateMs: 1000 },
      batch: { maxSize: 5, flushIntervalMs: 2000 },
      retry: { maxAttempts: 3, baseDelayMs: 1000 }
    },
    normal: {
      rateLimit: { maxTokens: 10, refillRateMs: 1000 },
      batch: { maxSize: 20, flushIntervalMs: 5000 },
      retry: { maxAttempts: 3, baseDelayMs: 1000 }
    }
  },
  compress: {
    enabled: true
  },
  maxBufferSize: 500,
  requestTimeoutMs: 10000,
  paused: false,
  onDropped: (reason, event) => {
    console.error('Event dropped:', reason, event);
  },
  onBatchDelivered: (eventIds) => {
    console.log('Batch delivered:', eventIds);
  }
});

// Start the transport
transport.start();

// Send events with different priorities
transport.send({
  id: crypto.randomUUID(),
  timestamp: Date.now(),
  type: 'track',
  event_name: 'page_view',
  properties: { page: '/home' },
  priority: EventPriority.Normal  // Goes to normal lane
});

transport.send({
  id: crypto.randomUUID(),
  timestamp: Date.now(),
  type: 'track',
  event_name: 'purchase',
  properties: { orderId: '12345', total: 99.99 },
  priority: EventPriority.High  // Goes to high lane
});

transport.send({
  id: crypto.randomUUID(),
  timestamp: Date.now(),
  type: 'track',
  event_name: 'exit_intent',
  properties: { page: '/checkout' },
  priority: EventPriority.Critical  // Goes to critical lane, sent immediately
});

// Monitor transport health
console.log('Queue size:', transport.queueSize);
console.log('Circuit open (throttling):', transport.circuitOpen);

// Pause during consent screen or network issues
transport.pause();

// Resume when ready
transport.start();

// Update normal lane batching dynamically
transport.updateBatchConfig(50, 10000); // batchSize: 50, timeout: 10s

// Flush all pending events
await transport.flush();

// Clean up
await transport.close();
```

### Unload/Drain Pattern

For page unload scenarios, use `drain()` to synchronously send all pending events:

```typescript
import { createClientTransport } from '@wince/transport';
import type { TrackEventPayload } from '@wince/types';

const transport = createClientTransport<MyEvent>({ /* options */ });
transport.start();

// Listen for page unload events
window.addEventListener('pagehide', () => {
  // drain() uses navigator.sendBeacon when available
  transport.drain();
});

window.addEventListener('beforeunload', () => {
  transport.drain();
});

// Handle visibility change (mobile browsers)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    transport.drain();
  }
});
```

### Custom HttpClient

You can provide a custom HTTP client for testing or special network requirements:

```typescript
import { Transport, IHttpClient } from '@wince/transport';
import type { HttpSenderOptions, SendBatchResult } from '@wince/transport';

class CustomHttpClient implements IHttpClient {
  async sendBatch(
    endpoint: string,
    batch: unknown[],
    options?: HttpSenderOptions
  ): Promise<SendBatchResult> {
    console.log('Sending to:', endpoint, 'Batch size:', batch.length);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: options?.headers,
      body: JSON.stringify(batch),
      keepalive: true
    });

    if (!response.ok) {
      return {
        success: false,
        retryable: response.status >= 500
      };
    }

    const result = await response.json();
    return {
      success: true,
      acceptedCount: result.accepted || batch.length,
      rejectedIds: result.rejected || []
    };
  }

  isHealthy(): boolean {
    return true;
  }
}

const transport = new Transport(new CustomHttpClient(), {
  url: 'https://api.example.com/v1/events',
  wsUrl: '',
  headers: {},
  exporterOpts: { /* ... */ },
  compress: { enabled: false },
  maxBufferSize: 500,
  requestTimeoutMs: 10000,
  paused: false,
  onDropped: () => {},
  onBatchDelivered: () => {}
});

transport.start();
```

### Tracking Events

```typescript
// Track custom events
function trackEvent(
  transport: Transport<TrackEventPayload>,
  eventName: string,
  properties: Record<string, unknown>,
  priority: 'normal' | 'high' | 'critical' = 'normal'
) {
  transport.send({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'track',
    event_name: eventName,
    properties,
    priority: priority === 'critical' 
      ? EventPriority.Critical 
      : priority === 'high' 
        ? EventPriority.High 
        : EventPriority.Normal
  });
}

// Usage
trackEvent(transport, 'button_click', { button_id: 'submit' });
trackEvent(transport, 'form_abandon', { form_id: 'contact' }, 'high');
trackEvent(transport, 'rage_click', { x: 100, y: 200 }, 'critical');
```

## API Reference

### `Transport<T>`

Main transport class that manages event queuing, batching, and delivery.

#### Methods

| Method | Description |
|--------|-------------|
| `send(event: T)` | Enqueue an event for delivery. Routes to appropriate priority lane based on `event.priority`. |
| `start()` | Resume automatic flushing on all lanes. Call after consent or network recovery. |
| `pause()` | Pause automatic flushing. Events are buffered and sent when `start()` is called. |
| `drain()` | Synchronously drain all lanes using `navigator.sendBeacon` (falls back to async flush). Use for page unload. |
| `flush(): Promise<void>` | Asynchronously flush all pending events from all lanes. |
| `close(): Promise<void>` | Close all exporters and clean up resources. |
| `updateBatchConfig(batchSize: number, batchTimeoutMs: number)` | Dynamically update the normal lane's batching configuration. |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `queueSize` | `number` | Total events across all lanes awaiting delivery. |
| `circuitOpen` | `boolean` | Whether any lane has opened its circuit breaker (throttling due to failures). |

### `createClientTransport<T>(opts)`

Factory function that creates a Transport instance with sensible defaults for browser usage.

```typescript
function createClientTransport<T extends TrackEventPayload>(
  opts: TransportOptions<T>
): Transport<T>
```

Uses:
- `BeaconClient` for unload scenarios
- `HttpClient` for HTTP requests
- `WebSocketClient` for real-time communication

### `TransportOptions<T>`

Configuration interface for creating a Transport instance.

```typescript
interface TransportOptions<T extends TrackEventPayload> {
  url: string;                          // HTTP endpoint for events
  wsUrl: string;                        // WebSocket URL
  headers: HeadersInit;                 // HTTP headers
  exporterOpts: {
    critical: ExporterOptions<T>;       // Critical lane config
    high: ExporterOptions<T>;           // High lane config
    normal: ExporterOptions<T>;         // Normal lane config
  };
  compress: {
    enabled: boolean;                   // Enable gzip compression
  };
  maxBufferSize: number;                // Max events in memory
  requestTimeoutMs: number;             // Per-request timeout (ms)
  paused: boolean;                      // Start in paused state
  onDropped: (reason: DropReason, item?: T) => void;
  onBatchDelivered: (eids: string[]) => void;
}
```

### `IHttpClient`

Interface for custom HTTP clients:

```typescript
interface IHttpClient {
  sendBatch(endpoint: string, batch: unknown[], options?: HttpSenderOptions): Promise<SendBatchResult>;
  isHealthy(): boolean;
}
```

## Configuration

### Exporter Options

Each lane (critical, high, normal) accepts `ExporterOptions`:

```typescript
interface ExporterOptions<T> {
  batch: {
    maxSize: number;          // Max events per batch
    flushIntervalMs: number;  // Time between flushes (0 = immediate)
  };
  rateLimit: {
    maxTokens: number;        // Max tokens in bucket
    refillRateMs: number;     // Time to refill all tokens
  };
  retry: {
    maxAttempts: number;      // Max retry attempts
    baseDelayMs: number;      // Initial delay before retry
  };
  compressFn?: (data: unknown) => Promise<Blob | undefined>;
  onBatchDelivered?: (itemIds: string[]) => void;
}
```

### Typical Configurations

#### Low-Traffic Site

```typescript
{
  normal: {
    batch: { maxSize: 10, flushIntervalMs: 10000 },  // 10 events or 10s
    rateLimit: { maxTokens: 10, refillRateMs: 2000 },
    retry: { maxAttempts: 3, baseDelayMs: 1000 }
  }
}
```

#### High-Traffic Site

```typescript
{
  normal: {
    batch: { maxSize: 50, flushIntervalMs: 5000 },   // 50 events or 5s
    rateLimit: { maxTokens: 50, refillRateMs: 1000 },
    retry: { maxAttempts: 5, baseDelayMs: 500 }
  },
  high: {
    batch: { maxSize: 20, flushIntervalMs: 2000 },
    rateLimit: { maxTokens: 20, refillRateMs: 500 },
    retry: { maxAttempts: 3, baseDelayMs: 500 }
  }
}
```

#### Critical Event Focus

```typescript
{
  critical: {
    batch: { maxSize: 1, flushIntervalMs: 0 },       // Always immediate
    rateLimit: { maxTokens: 15, refillRateMs: 1000 }, // Higher burst capacity
    retry: { maxAttempts: 5, baseDelayMs: 500 }       // More retries
  }
}
```

## Browser Support

- Modern browsers with `fetch` API
- `navigator.sendBeacon` support (graceful fallback)
- WebSocket support (optional)

## Graceful Degradation

The transport layer automatically adapts to network conditions:

- **Circuit Breaker**: Opens after repeated failures, preventing retry storms
- **Rate Limiting**: Prevents overwhelming the server
- **Compression**: Reduces payload size (gzip)
- **Retry Logic**: Exponential backoff with jitter
- **Beacon Fallback**: Uses `sendBeacon` for unload scenarios when possible

## Dependencies

- `@wince/types` — Event types and interfaces
- `@wince/utils` — Compression and serialization utilities
- `@wince/compress` — Optional compression support

## Testing

```bash
# Run transport tests
npx jest --config jest.config.ts packages/transport/tests/

# Run all tests
npx nx test transport
```

## License

Private — part of the Wince tracker monorepo.