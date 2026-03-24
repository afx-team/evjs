/**
 * Route handlers for the /api/posts REST endpoint.
 *
 * Demonstrates:
 * - Multiple HTTP methods on a single path
 * - Dynamic route params
 * - JSON request/response
 * - Custom status codes
 */

import { route } from "@evjs/server";

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

/** List + Create posts. */
export const postsHandler = route("/api/posts", {
  GET: async (req) => {
    // Support ?limit query param
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || posts.length;
    return Response.json(posts.slice(0, limit));
  },

  POST: async (req) => {
    const { title, body } = (await req.json()) as {
      title: string;
      body: string;
    };

    if (!title || !body) {
      return Response.json(
        { error: "title and body are required" },
        { status: 400 },
      );
    }

    const post: Post = {
      id: String(nextId++),
      title,
      body,
      createdAt: new Date().toISOString(),
    };
    posts.push(post);

    return Response.json(post, { status: 201 });
  },
});

/** Get, Update, Delete a single post. */
export const postHandler = route("/api/posts/:id", {
  GET: async (_req, { params }) => {
    const post = posts.find((p) => p.id === params.id);
    if (!post) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }
    return Response.json(post);
  },

  PUT: async (req, { params }) => {
    const idx = posts.findIndex((p) => p.id === params.id);
    if (idx === -1) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }

    const { title, body } = (await req.json()) as {
      title?: string;
      body?: string;
    };
    if (title) posts[idx].title = title;
    if (body) posts[idx].body = body;

    return Response.json(posts[idx]);
  },

  DELETE: async (_req, { params }) => {
    const idx = posts.findIndex((p) => p.id === params.id);
    if (idx === -1) {
      return Response.json({ error: "Post not found" }, { status: 404 });
    }
    posts.splice(idx, 1);
    return new Response(null, { status: 204 });
  },
});
