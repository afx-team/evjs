# basic-server-routes

Programmatic REST route handlers using `createRouteHandler()`.

## Run

```bash
npm run dev -w example-basic-server-routes
```

## Key Files

| File | Purpose |
|------|---------| 
| `src/server.ts` | Mounts route handlers via `createApp({ routeHandlers })` |
| `src/api/posts.routes.ts` | CRUD route handlers for `/api/posts` |
| `src/api/health.routes.ts` | Health check endpoint |

## What It Demonstrates

- `createRouteHandler(path, { GET, POST, PUT, DELETE })` for REST endpoints
- Dynamic route params (`:id`)
- Query string parsing (`?limit=N`)
- Custom status codes (201, 204, 404)
- Auto `OPTIONS` and `405 Method Not Allowed`
- Mounting handlers via `createApp({ routeHandlers: [...] })`

## Try It

```bash
# List posts
curl http://localhost:3000/api/posts

# Create a post
curl -X POST http://localhost:3000/api/posts \
  -H 'Content-Type: application/json' \
  -d '{"title":"New Post","body":"Hello!"}'

# Get single post
curl http://localhost:3000/api/posts/1

# Update a post
curl -X PUT http://localhost:3000/api/posts/1 \
  -H 'Content-Type: application/json' \
  -d '{"title":"Updated Title"}'

# Delete a post
curl -X DELETE http://localhost:3000/api/posts/1

# Health check
curl http://localhost:3000/api/health

# Auto OPTIONS
curl -X OPTIONS http://localhost:3000/api/posts -i
```
