# custom-ws-transport

Custom WebSocket transport for server function calls.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `src/layout/index.tsx` | SPA root layout |
| `src/pages/index.tsx` | `initTransport` with WebSocket adapter and users CRUD UI |
| `src/api/users.server.ts` | Server functions |


## What It Demonstrates

- Custom `TransportAdapter` over WebSocket
- `initTransport({ adapter: { send } })` extension
- `dispatch()` for protocol-agnostic server-side handling
- Same server functions work over HTTP and WebSocket
