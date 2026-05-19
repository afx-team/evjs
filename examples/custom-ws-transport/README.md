# custom-ws-transport

Custom WebSocket transport for server function calls.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | `initTransport` with WebSocket adapter |
| `src/routes.tsx` | UI with users CRUD |
| `src/api/users.server.ts` | Server functions |


## What It Demonstrates

- Custom `TransportAdapter` over WebSocket
- `initTransport({ adapter: { send } })` extension
- `dispatch()` for protocol-agnostic server-side handling
- Same server functions work over HTTP and WebSocket
