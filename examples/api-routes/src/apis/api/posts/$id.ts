/**
 * Dynamic route handlers for /api/posts/:id.
 */

import { posts } from "../posts-store";

interface RouteContext {
  req: {
    param(name: string): string;
  };
}

/** Get a single post. */
export const GET = async (_req: Request, ctx: RouteContext) => {
  const id = ctx.req.param("id");
  const post = posts.find((p) => p.id === id);
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  return Response.json(post);
};

/** Update a single post. */
export const PUT = async (req: Request, ctx: RouteContext) => {
  const id = ctx.req.param("id");
  const idx = posts.findIndex((p) => p.id === id);
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
};

/** Delete a single post. */
export const DELETE = async (_req: Request, ctx: RouteContext) => {
  const id = ctx.req.param("id");
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  posts.splice(idx, 1);
  return new Response(null, { status: 204 });
};
