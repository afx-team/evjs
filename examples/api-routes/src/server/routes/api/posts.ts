/**
 * Route handlers for the /api/posts REST endpoint.
 *
 * Demonstrates:
 * - Multiple HTTP methods on a single file path
 * - JSON request/response
 * - Custom status codes
 */

import { createPost, posts } from "./posts-store";

/** List posts. */
export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || posts.length;
  return Response.json(posts.slice(0, limit));
};

/** Create a post. */
export const POST = async (req: Request) => {
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

  return Response.json(createPost({ title, body }), { status: 201 });
};
