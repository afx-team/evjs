# custom-ws-transport

Custom WebSocket transport for server function calls.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------|
| `ev.config.ts` | Selects SPA routing mode |
| `src/pages/layout.tsx` | File-convention root layout |
| `src/pages/page.tsx` | `initTransport` with WebSocket adapter and users CRUD UI |
| `src/apis/users.server.ts` | Server functions |


## What It Demonstrates

- Custom `TransportAdapter` over WebSocket
- `initTransport({ adapter: { send } })` extension
- `dispatch()` for protocol-agnostic server-side handling
- Same server functions work over HTTP and WebSocket
- Transport setup inside the root Page scope
