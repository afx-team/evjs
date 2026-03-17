# websocket-fns

Custom WebSocket transport for server function calls.

## Run

```bash
npm run dev -w example-websocket-fns
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | `initTransport` with WebSocket transport |
| `src/routes.tsx` | UI with users CRUD |
| `src/api/users.server.ts` | Server functions |
| `ev.config.ts` | WebSocket middleware setup |

## What It Demonstrates

- Custom `ServerTransport` over WebSocket
- `initTransport({ transport: { send } })` configuration
- `dispatch()` for protocol-agnostic server-side handling
- Same server functions work over HTTP and WebSocket
