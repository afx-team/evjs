/**
 * Server entry — mounts route handlers onto the ev app.
 */

import { createApp } from "@evjs/server";
import { healthHandler } from "./api/health.routes";
import { postHandler, postsHandler } from "./api/posts.routes";

const app = createApp({
  routes: [healthHandler, postsHandler, postHandler],
});

export default { fetch: app.fetch };
