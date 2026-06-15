import { createApp, requestLogger } from "@evjs/ev/server";
import { createReactFrameworkServer } from "@evjs/ev/server/react";
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
