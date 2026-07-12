# @wince/messaging

Bidirectional messaging client for server→tracker command delivery.

## Overview

The messaging package provides a real-time command channel from the backend to the tracker. It supports interventions (e.g., show survey, reload config, A/B test assignment) pushed from the server.

### Architecture

```
┌─────────────┐     WebSocket (primary)     ┌──────────────┐
│  Messaging  │◄───────────────────────────►│   Backend    │
│   Client    │     HTTP polling (fallback) │   Server     │
└──────┬──────┘                             └──────────────┘
       │
       ▼
┌──────────────┐
│  Command     │  dispatch by type
│  Registry    │  → show_survey()
│              │  → reload_config()
└──────────────┘  → custom handlers
```

### Channels

1. **WebSocket (primary)**: Server pushes commands in real-time via WS frames with `type: "Command"`. Zero latency, bidirectional.

2. **HTTP polling (fallback)**: When WS is unavailable (firewall, network issue), the client polls an HTTP endpoint. Commands are returned in the response body as `{ commands: ServerCommand[] }`.

## Usage

```typescript
import { MessagingClient, CommandRegistry } from '@wince/messaging';

// 1. Create a command registry with handlers
const registry = new CommandRegistry();
registry.register('show_survey', (payload) => {
  showSurveyWidget(payload.surveyId);
});
registry.register('reload_config', () => {
  location.reload();
});
registry.register('set_flag', (payload) => {
  featureFlags.set(payload.key, payload.value);
});

// 2. Create and start the messaging client
const messaging = new MessagingClient({
  wsUrl: 'wss://api.example.com/ws',
  httpUrl: 'https://api.example.com/commands/poll',
  onCommand: (cmd) => registry.execute(cmd),
  pollIntervalMs: 30_000, // HTTP fallback poll interval
});

messaging.start();

// 3. Acknowledge command receipt (optional)
messaging.ack(cmd.requestId);

// 4. Clean up on page unload
window.addEventListener('pagehide', () => messaging.stop());
```

## API

### `MessagingClient`

| Method | Description |
|--------|-------------|
| `constructor(opts)` | Create client with WS URL, HTTP URL, and command handler |
| `start()` | Connect WS and start HTTP polling fallback |
| `stop()` | Close WS, stop polling, clean up resources |
| `connected` | Whether WS connection is active |
| `ack(requestId)` | Send command acknowledgement to server |

### `CommandRegistry`

| Method | Description |
|--------|-------------|
| `register(type, handler)` | Register handler for a command type |
| `unregister(type)` | Remove handler by type |
| `has(type)` | Check if handler is registered |
| `execute(cmd)` | Execute handler for a command (async) |
| `clear()` | Remove all handlers |
| `registeredTypes` | List all registered command types |

### `ServerCommand`

```typescript
interface ServerCommand {
  type: string;       // e.g. 'show_survey', 'reload_config'
  payload: unknown;   // command-specific data
  requestId: string;  // unique ID for ack tracking
}
```

## Dependencies

- `@wince/transport` — WebSocket client, HTTP client
- `@wince/utils` — serialization utilities

## Testing

```bash
npx jest --config jest.config.ts packages/messaging/tests/
```

## License

Private — part of the Wince tracker monorepo.