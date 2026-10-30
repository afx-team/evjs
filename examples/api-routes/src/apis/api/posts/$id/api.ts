/** Dynamic route handlers for /api/posts/:id. */

import { withMiddlewares } from "@evjs/ev/api";
import { posts } from "@/apis/api/posts/posts-store";
import { apiPolicies } from "../../policies";

/** Get a single post. */
export const GET = withMiddlewares(async (_req, ctx) => {
  const id = ctx.req.param("id");
  const post = posts.find((p) => p.id === id);
  if (!post) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  return Response.json(post);
}, apiPolicies);

/** Update a single post. */
export const PUT = withMiddlewares(async (req, ctx) => {
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
}, apiPolicies);

/** Delete a single post. */
export const DELETE = withMiddlewares(async (_req, ctx) => {
  const id = ctx.req.param("id");
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) {
    return Response.json({ error: "Post not found" }, { status: 404 });
  }
  posts.splice(idx, 1);
  return new Response(null, { status: 204 });
}, apiPolicies);
