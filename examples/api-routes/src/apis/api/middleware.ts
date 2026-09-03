import type { MiddlewareChain, MiddlewareHandler } from "@evjs/ev/api";

const blockRequest: MiddlewareHandler = async (ctx, next) => {
  if (ctx.req.header("x-block-api") === "true") {
    return Response.json(
      { error: "blocked by route middleware" },
      { status: 403 },
    );
  }
  await next();
};

const apiMetadata: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-api-scope", "api");
};

export default [blockRequest, apiMetadata] satisfies MiddlewareChain;
