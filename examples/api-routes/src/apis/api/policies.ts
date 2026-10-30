import type { MiddlewareChain, MiddlewareHandler } from "@evjs/ev/middleware";

const blockRequest: MiddlewareHandler = async (ctx, next) => {
  if (ctx.req.header("x-block-api") === "true") {
    return Response.json(
      { error: "blocked by API middleware" },
      { status: 403 },
    );
  }
  await next();
};

const apiMetadata: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-api-policy", "applied");
};

export const apiPolicies = [
  blockRequest,
  apiMetadata,
] satisfies MiddlewareChain;
