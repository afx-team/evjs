/**
 * Route handlers for the /api/posts REST endpoint.
 *
 * Demonstrates:
 * - Multiple HTTP methods on one api.ts anchor
 * - JSON request/response
 * - Custom status codes
 * - Method-specific middleware with a shared request body cache
 */

import { withMiddlewares } from "@evjs/ev/api";
import { createPost, posts } from "./posts-store";
import validatePost from "./validate-post";

/** List posts. */
export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || posts.length;
  return Response.json(posts.slice(0, limit));
};

/** Create a post. */
export const POST = withMiddlewares(async (_req, ctx) => {
  const { title, body } = await ctx.req.json<{
    title: string;
    body: string;
  }>();

  return Response.json(createPost({ title, body }), { status: 201 });
}, validatePost);
