import { Link, Navigate, redirect, useLinkProps } from "@evjs/client";
import { useLinkProps as useTanStackLinkProps } from "@tanstack/react-router";
import type { CreatePageRouteRegister } from "../src/route-types";

type Empty = Record<PropertyKey, never>;

type EvPageIndexModule = Empty;
type EvPagePostModule = Empty;

interface EvPageSearchModule {
  validateSearch(search: Record<string, unknown>): {
    q: string;
    page: number;
  };
}

interface EvPageRoutes {
  index: { id: "index"; path: "/"; module: EvPageIndexModule };
  posts_postId: {
    id: "posts_postId";
    path: "/posts/$postId";
    module: EvPagePostModule;
  };
  search: { id: "search"; path: "/search"; module: EvPageSearchModule };
}

declare module "@evjs/client" {
  interface Register extends CreatePageRouteRegister<EvPageRoutes> {}
}

export function PageRouteLinkTypeTests() {
  useLinkProps({ to: "/" });
  useLinkProps({ to: "/posts/$postId", params: { postId: "p1" } });
  useLinkProps({ to: "/search", search: { q: "router", page: 1 } });
  Link({ to: "/posts/$postId", params: { postId: "p1" }, children: "Post" });
  Navigate({ to: "/search", search: { q: "router", page: 1 } });
  redirect({ to: "/posts/$postId", params: { postId: "p1" } });

  // @ts-expect-error unknown page route paths are rejected.
  useLinkProps({ to: "/missing" });

  // @ts-expect-error dynamic page routes require their params.
  useLinkProps({ to: "/posts/$postId" });

  // @ts-expect-error dynamic params must match the page route segment name.
  useLinkProps({ to: "/posts/$postId", params: { id: "p1" } });

  // @ts-expect-error search objects follow validateSearch output.
  useLinkProps({ to: "/search", search: { q: "router", page: "one" } });

  // @ts-expect-error Link uses the generated file-route path list.
  Link({ to: "/missing" });

  // @ts-expect-error Navigate requires dynamic params for file routes.
  Navigate({ to: "/posts/$postId" });

  // @ts-expect-error redirect validates route search objects.
  redirect({ to: "/search", search: { q: "router", page: "one" } });

  // Generated evjs route types should not leak into TanStack Router's public module.
  useTanStackLinkProps({ to: "/missing" });

  return null;
}
