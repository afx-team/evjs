import type { MiddlewareHandler } from "@evjs/ev/middleware";

const validatePost: MiddlewareHandler = async (ctx, next) => {
  let value: unknown;
  try {
    value = await ctx.req.json();
  } catch {
    return ctx.json({ error: "A JSON request body is required" }, 400);
  }

  if (
    !value ||
    typeof value !== "object" ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !value.title ||
    !("body" in value) ||
    typeof value.body !== "string" ||
    !value.body
  ) {
    return ctx.json({ error: "title and body are required" }, 400);
  }

  await next();
  ctx.header("x-post-validated", "true");
};

export default validatePost;
