/**
 * Route handlers for the /api/posts REST endpoint.
 *
 * Demonstrates:
 * - Multiple HTTP methods on a single path
 * - Dynamic route params
 * - JSON request/response
 * - Custom status codes
 */

import { Hono } from "hono";

/** Simulated post database. */
interface Post {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

const posts: Post[] = [
  {
    id: "1",
    title: "Hello World",
    body: "Welcome to evjs route handlers!",
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    title: "REST is not dead",
    body: "Route handlers bring REST APIs to evjs.",
    createdAt: new Date().toISOString(),
  },
];

let nextId = 3;

/** REST Endpoints for Posts */
export const postsApp = new Hono()
  .get("/api/posts", (c) => {
    // Support ?limit query param
    const url = new URL(c.req.url);
    const limit = Number(url.searchParams.get("limit")) || posts.length;
    return c.json(posts.slice(0, limit));
  })
  .post("/api/posts", async (c) => {
    const { title, body } = await c.req.json<{ title: string; body: string }>();

    if (!title || !body) {
      return c.json({ error: "title and body are required" }, 400);
    }

    const post: Post = {
      id: String(nextId++),
      title,
      body,
      createdAt: new Date().toISOString(),
    };
    posts.push(post);

    return c.json(post, 201);
  })
  .get("/api/posts/:id", (c) => {
    const id = c.req.param("id");
    const post = posts.find((p) => p.id === id);
    if (!post) {
      return c.json({ error: "Post not found" }, 404);
    }
    return c.json(post);
  })
  .put("/api/posts/:id", async (c) => {
    const id = c.req.param("id");
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) {
      return c.json({ error: "Post not found" }, 404);
    }

    const { title, body } = await c.req.json<{
      title?: string;
      body?: string;
    }>();
    if (title) posts[idx].title = title;
    if (body) posts[idx].body = body;

    return c.json(posts[idx]);
  })
  .delete("/api/posts/:id", (c) => {
    const id = c.req.param("id");
    const idx = posts.findIndex((p) => p.id === id);
    if (idx === -1) {
      return c.json({ error: "Post not found" }, 404);
    }
    posts.splice(idx, 1);
    return new Response(null, { status: 204 });
  });
