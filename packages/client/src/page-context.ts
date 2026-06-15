import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
} from "react";
import type {
  PageRouteLoaderData,
  PageRouteParams,
  PageRoutePath,
  PageRouteSearch,
} from "./route-types.js";

export interface PageProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  params: TParams;
  search: TSearch;
  loaderData: TLoaderData;
}

export interface PageProviderProps<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
> {
  value: PageProps<TParams, TSearch, TLoaderData>;
  children?: ReactNode;
}

const PageContext = createContext<PageProps | undefined>(undefined);

export function PageProvider({ value, children }: PageProviderProps) {
  return createElement(PageContext.Provider, { value }, children);
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
  const ctx = useContext(PageContext);
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
