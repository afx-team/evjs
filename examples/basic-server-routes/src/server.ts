/**
 * Server entry — mounts route handlers onto the ev app.
 */

import { createApp } from "@evjs/server";
import { healthApp } from "./api/health.routes";
import { postsApp } from "./api/posts.routes";

export const app = createApp().route("/", healthApp).route("/", postsApp);

export type AppType = typeof app;
