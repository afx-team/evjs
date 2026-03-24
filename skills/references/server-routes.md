# Server Routes

## Overview

evjs allows creating programmatic REST APIs using native Hono instances. Rather than automagical `"use server"` RPC wrappers, these handlers give you full control over HTTP methods, headers, and standard Web `Request`/`Response` objects—while maintaining **100% end-to-end type safety** via Hono's `hc` client.

## Usage

Server routes are defined by creating standard `Hono` instances. You can then mount these routes using `createApp().route('/path', subApp)`.

```ts
// src/api/posts.routes.ts
import { Hono } from "hono";

export const postsApp = new Hono()
  .get("/api/posts", async (c) => {
    return c.json([{ id: 1, title: "Hello World" }]);
  })
  .post("/api/posts", async (c) => {
    const data = await c.req.json<{ title: string }>();
    return c.json({ success: true, data }, 201);
  });
```

### Path Parameters & Dynamic Routes

Dynamic path parameters use the standard Hono syntax (`/:id`).

```ts
export const postDetailsApp = new Hono()
  .get("/api/posts/:id", async (c) => {
    const id = c.req.param("id");
    return c.json({ id, title: "Post Details" });
  });
```

### Context & Middleware Chaining

Since these are native Hono apps, you can use any standard Hono middleware (e.g., `hono/cors`, `hono/logger`, or custom middleware) directly on your instances.

## Configuration & Type Safety

To reap the benefits of `evjs`'s end-to-end type safety, you must structure your sub-apps correctly in a central `server.ts` entry file, then generate an `AppType`.

### 1. Build the App Server

```ts
// src/server.ts
import { createApp } from "@evjs/server";
import { postsApp, postDetailsApp } from "./api/posts.routes";

// Mount the sub-apps and export the combined Type
export const app = createApp()
  .route("/", postsApp)
  .route("/", postDetailsApp);

export type AppType = typeof app;
```

### 2. Configure `ev.config.ts`

Set the `server.entry` to tell the build tools about your custom server file.

```ts
import { defineConfig } from "@evjs/cli";

export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: { port: 3001 }
  }
});
```

### 3. Fetch Data Safely in React

On the frontend, use the `hc` (Hono Client) and pass it your `AppType`. This gives you flawless autocomplete and type-checking across the network boundary!

```tsx
import { hc } from "@evjs/client";
import type { AppType } from "./server";

const client = hc<AppType>("/");

async function fetchPosts() {
  const res = await client.api.posts.$get();
  const data = await res.json();
  console.log(data); // Fully typed!
}
```

> [!NOTE]
> If you combine programmatic Hono mounts with `"use server"` Server Functions, `createApp()` handles **both automatically**. Your programmatic routes are mounted first, and the framework fallback handles your RPC POST requests at `/api/fn`.
