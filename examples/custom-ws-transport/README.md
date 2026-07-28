# custom-ws-transport

Client-side `TransportAdapter` example for sending server-function calls over
WebSocket. This repository does not provide the matching WebSocket server.

## Run

```bash
npm run dev
```

The page shell runs locally, but server-function calls require a same-origin
`/ws` endpoint that accepts the documented `{ id, fnId, args }` messages and
returns `{ id, result }` or `{ id, error }`.

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
- Request correlation and pending-call cleanup for a custom client protocol
- The client message contract a matching WebSocket server must implement
- Transport setup inside the root Page scope
