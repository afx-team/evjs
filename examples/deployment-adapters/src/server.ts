import { createApp, requestLogger } from "@evjs/server";
import { createReactFrameworkServer } from "@evjs/server/react";
import "./api/operators.server";
import { healthRoute } from "./api/health.routes";

const app = createApp({
  middlewares: [requestLogger({ includeSearch: true })],
  routes: [healthRoute],
  framework: createReactFrameworkServer(),
});

export default {
  fetch: app.fetch,
};
