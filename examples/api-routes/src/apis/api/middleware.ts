import type { MiddlewareHandler } from "@evjs/ev/request";

const middleware: MiddlewareHandler = async (ctx, next) => {
  if (ctx.req.header("x-block-api") === "true") {
    return Response.json(
      { error: "blocked by route middleware" },
      { status: 403 },
    );
  }

  await next();
  ctx.header("x-api-scope", "api");
};

export default middleware;
