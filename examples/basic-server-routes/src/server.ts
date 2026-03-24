/**
 * Server entry — mounts route handlers onto the ev app.
 */

import { createApp } from "@evjs/server";
import { healthHandler } from "./api/health.routes";
import { postHandler, postsHandler } from "./api/posts.routes";

export const app = createApp({
  routeHandlers: [healthHandler, postsHandler, postHandler],
});
