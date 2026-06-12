/**
 * Type-safety tests for public @evjs/client navigation helpers.
 *
 * The route tree is assembled with internal test helpers so the public client
 * entry can stay focused on page logic instead of exposing route constructors.
 */

import { Link, type ToOptions, useLinkProps } from "@evjs/client";
import { createApp } from "../src/app";
import { createAppRootRoute } from "../src/context";
import { createRoute } from "../src/route";

const rootRoute = createAppRootRoute({
  component: () => null,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts/$postId",
  component: () => null,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
    page: Number(search.page) || 1,
  }),
  component: () => null,
});

const routeTree = rootRoute.addChildren([homeRoute, postRoute, searchRoute]);
const app = createApp({ routeTree });

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

export const postToOptions: ToOptions<
  typeof app.router,
  "/",
  "/posts/$postId"
> = {
  to: "/posts/$postId",
  params: { postId: "123" },
};

export function LinkTests() {
  <Link to="/posts/$postId" params={{ postId: "123" }} />;
  <Link to="/" />;
  <Link to="/search" search={{ q: "test", page: 1 }} />;

  // @ts-expect-error - missing required postId param
  <Link to="/posts/$postId" />;

  // @ts-expect-error - wrong param name
  <Link to="/posts/$postId" params={{ wrongParam: "123" }} />;

  // @ts-expect-error - invalid route path
  <Link to="/not-a-real-route" />;
}

export function HookExportTests() {
  const props = useLinkProps({
    to: "/posts/$postId",
    params: { postId: "123" },
  });

  return <a {...props}>Open post</a>;
}
