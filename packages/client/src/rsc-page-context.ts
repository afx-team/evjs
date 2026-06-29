/// <reference types="node" />

import { AsyncLocalStorage } from "node:async_hooks";
import { matchPageRouteParams, parsePageSearch } from "@evjs/shared";
import { type ComponentType, createElement } from "react";
import { renderToReadableStream } from "react-server-dom-webpack/server.node";
import type { PageProps } from "./page-context.js";
import type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./route-types.js";

const storage = new AsyncLocalStorage<PageProps>();

interface RscPageRuntime {
  buildId: string;
  routing?: {
    kind: "spa" | "mpa";
    routes?: Array<{
      id: string;
      path: string;
      pageId?: string;
    }>;
    pages?: Record<
      string,
      {
        path?: string;
        routeId?: string;
      }
    >;
  };
  /** @deprecated Use routing. */
  routes?: Array<{
    id: string;
    path: string;
    pageId?: string;
  }>;
  rsc?: {
    clientReferenceManifest?: Record<string, unknown>;
  };
}

export interface RscPageFlightRenderContext {
  runtime: RscPageRuntime;
  pageId?: string;
  pageUrl?: string;
  request: Request;
}

export function runPageContext<T>(value: PageProps, render: () => T): T {
  return storage.run(value, render);
}

export function createRscPageFlightRenderer(
  Component: ComponentType<Record<string, unknown>>,
): (ctx: RscPageFlightRenderContext) => Promise<Response> {
  return async function renderFlight(ctx) {
    const clientReferenceManifest = ctx.runtime.rsc?.clientReferenceManifest;
    if (!clientReferenceManifest) {
      return new Response(
        "[evjs] RSC client reference manifest is not available.",
        {
          status: 501,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        },
      );
    }

    const props = createRscPageProps(ctx);
    const stream = await runPageContext(createRscPageContext(ctx, props), () =>
      renderToReadableStream(
        createElement(Component, stripRscPageRouteProps(props)),
        clientReferenceManifest,
      ),
    );
    return new Response(stream, {
      headers: {
        "Content-Type": "text/x-component; charset=utf-8",
      },
    });
  };
}

export function usePageContext<const TPath extends PageRoutePath>(
  path: TPath,
): PageProps<
  PageRouteParams<TPath>,
  PageRouteSearch<TPath>,
  PageRouteLoaderData<TPath>
>;
export function usePageContext<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
>(): PageProps<TParams, TSearch, TLoaderData>;
export function usePageContext(_path?: string): PageProps {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "[evjs] Page route data hooks must be used inside an evjs page.",
    );
  }
  return ctx;
}

export function usePageParams<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteParams<TPath>;
export function usePageParams<
  TParams extends Record<string, string> = Record<string, string>,
>(): TParams;
export function usePageParams(_path?: string): Record<string, string> {
  return usePageContext().params;
}

export function usePageSearch<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteSearch<TPath>;
export function usePageSearch<
  TSearch extends Record<string, unknown> = Record<string, unknown>,
>(): TSearch;
export function usePageSearch(_path?: string): Record<string, unknown> {
  return usePageContext().search;
}

export function usePageLoaderData<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteLoaderData<TPath>;
export function usePageLoaderData<TLoaderData = unknown>(): TLoaderData;
export function usePageLoaderData(_path?: string): unknown {
  return usePageContext().loaderData;
}

function findRouteForPage(
  runtime: RscPageRuntime,
  pageId: string | undefined,
): { id: string; path: string } | undefined {
  if (!pageId) return undefined;
  const route = getRuntimeRoutes(runtime).find(
    (candidate) => candidate.pageId === pageId,
  );
  return route
    ? {
        id: route.id,
        path: route.path,
      }
    : undefined;
}

function getRuntimeRoutes(
  runtime: RscPageRuntime,
): Array<{ id: string; path: string; pageId?: string }> {
  if (runtime.routing?.kind === "spa") return runtime.routing.routes ?? [];
  if (runtime.routing?.kind === "mpa") {
    return Object.entries(runtime.routing.pages ?? {}).flatMap(
      ([pageId, page]) =>
        page.path && page.routeId
          ? [{ id: page.routeId, path: page.path, pageId }]
          : [],
    );
  }
  return runtime.routes ?? [];
}

function createRscPageProps(ctx: RscPageFlightRenderContext): PageProps & {
  runtime: { buildId: string };
  pageId?: string;
  route?: { id: string; path: string };
} {
  return {
    runtime: {
      buildId: ctx.runtime.buildId,
    },
    pageId: ctx.pageId,
    route: findRouteForPage(ctx.runtime, ctx.pageId),
    params: {},
    search: {},
    loaderData: undefined,
  };
}

function resolveRenderUrl(ctx: RscPageFlightRenderContext): URL {
  return new URL(ctx.pageUrl || ctx.request.url, ctx.request.url);
}

function createRscPageContext(
  ctx: RscPageFlightRenderContext,
  props: ReturnType<typeof createRscPageProps>,
): PageProps {
  const route = props.route;
  const url = resolveRenderUrl(ctx);
  return {
    params: route ? matchPageRouteParams(route.path, url.pathname) : {},
    search: parsePageSearch(url.search),
    loaderData: props.loaderData,
  };
}

function stripRscPageRouteProps(
  props: ReturnType<typeof createRscPageProps>,
): Record<string, unknown> {
  const { params, search, loaderData, ...rest } = props;
  return rest;
}
