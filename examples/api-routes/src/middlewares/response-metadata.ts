import type { MiddlewareHandler } from "@evjs/ev/middleware";

const responseMetadata: MiddlewareHandler = async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  ctx.header("x-example-server", "api-routes");
  ctx.header("x-response-time-ms", String(Date.now() - startedAt));
};

export default responseMetadata;
