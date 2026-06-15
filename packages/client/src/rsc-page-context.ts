/// <reference types="node" />

import { AsyncLocalStorage } from "node:async_hooks";
import type { PageProps } from "./page-context.js";
import type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./route-types.js";

const storage = new AsyncLocalStorage<PageProps>();

export function runPageContext<T>(value: PageProps, render: () => T): T {
  return storage.run(value, render);
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
