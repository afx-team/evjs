import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
} from "react";

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

export function usePageContext<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
>(): PageProps<TParams, TSearch, TLoaderData> {
  const ctx = useContext(PageContext);
  if (!ctx) {
    throw new Error(
      "[evjs] Page route data hooks must be used inside an evjs page.",
    );
  }
  return ctx as PageProps<TParams, TSearch, TLoaderData>;
}

export function usePageParams<
  TParams extends Record<string, string> = Record<string, string>,
>(): TParams {
  return usePageContext<TParams>().params;
}

export function usePageSearch<
  TSearch extends Record<string, unknown> = Record<string, unknown>,
>(): TSearch {
  return usePageContext<Record<string, string>, TSearch>().search;
}

export function usePageLoaderData<TLoaderData = unknown>(): TLoaderData {
  return usePageContext<
    Record<string, string>,
    Record<string, unknown>,
    TLoaderData
  >().loaderData;
}
