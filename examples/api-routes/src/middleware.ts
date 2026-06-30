import type { MiddlewareHandler } from "@evjs/ev/server-context";

const middleware: MiddlewareHandler = async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  ctx.header("x-example-server", "api-routes");
  ctx.header("x-response-time-ms", String(Date.now() - startedAt));
};

export default middleware;
