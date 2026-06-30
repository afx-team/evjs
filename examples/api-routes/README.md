# api-routes

REST route handlers using default server file routes.

## Run

```bash
npm run dev
```

## Key Files

| File | Purpose |
|------|---------| 
| `src/middleware.ts` | Framework request middleware for all server requests |
| `src/apis/api/middleware.ts` | API route middleware for `/api/**` file routes |
| `src/apis/api/posts.ts` | List/create handlers for `/api/posts` |
| `src/apis/api/posts/$id.ts` | Dynamic handlers for `/api/posts/:id` |
| `src/apis/api/health.ts` | Health check endpoint |
| `src/apis/api/posts-store.ts` | Colocated helper module ignored by route discovery |

## What It Demonstrates

- Uppercase method exports (`GET`, `POST`, `PUT`, `DELETE`) for REST endpoints
- Dynamic route files (`$id.ts` -> `:id`)
- Query string parsing (`?limit=N`)
- Custom status codes (201, 204, 404)
- Auto `OPTIONS` and `405 Method Not Allowed`
- Framework request and API route `middleware.ts` conventions
- Colocated helper files without route exports

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

# API route middleware short-circuit
curl -H 'x-block-api: true' http://localhost:3000/api/posts -i
```
