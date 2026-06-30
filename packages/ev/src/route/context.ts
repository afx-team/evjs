import {
  usePageContext as useClientPageContext,
  usePageLoaderData as useClientPageLoaderData,
  usePageParams as useClientPageParams,
  usePageSearch as useClientPageSearch,
} from "@evjs/client";
import type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./types.js";

export interface PageProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  params: TParams;
  search: TSearch;
  loaderData: TLoaderData;
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
  return useClientPageContext() as PageProps;
}

export function usePageParams<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteParams<TPath>;
export function usePageParams<
  TParams extends Record<string, string> = Record<string, string>,
>(): TParams;
export function usePageParams(_path?: string): Record<string, string> {
  return useClientPageParams();
}

export function usePageSearch<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteSearch<TPath>;
export function usePageSearch<
  TSearch extends Record<string, unknown> = Record<string, unknown>,
>(): TSearch;
export function usePageSearch(_path?: string): Record<string, unknown> {
  return useClientPageSearch();
}

export function usePageLoaderData<const TPath extends PageRoutePath>(
  path: TPath,
): PageRouteLoaderData<TPath>;
export function usePageLoaderData<TLoaderData = unknown>(): TLoaderData;
export function usePageLoaderData(_path?: string): unknown {
  return useClientPageLoaderData();
}
