import {
  Link,
  Navigate,
  redirect,
  useLinkProps,
  usePageContext,
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "@evjs/client";
import { useLinkProps as useTanStackLinkProps } from "@tanstack/react-router";
import type { CreatePageRouteRegister } from "../src/route-types";

type Empty = Record<PropertyKey, never>;

type EvPageIndexModule = Empty;
interface EvPagePostModule {
  loader(): Promise<{ title: string }>;
}

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

  const postParams = usePageParams("/posts/$postId");
  postParams.postId.toUpperCase();

  const search = usePageSearch("/search");
  search.page.toFixed();

  const postData = usePageLoaderData("/posts/$postId");
  postData.title.toUpperCase();

  const postContext = usePageContext("/posts/$postId");
  postContext.params.postId.toUpperCase();
  postContext.loaderData.title.toUpperCase();

  // @ts-expect-error unknown page route paths are rejected.
  useLinkProps({ to: "/missing" });

  // @ts-expect-error page data hooks use the generated route path list.
  usePageParams("/missing");

  // @ts-expect-error route params follow dynamic segment names.
  postParams.id;

  // @ts-expect-error search objects follow validateSearch output.
  search.page.toUpperCase();

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
