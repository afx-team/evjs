/// <reference types="node" />

import { AsyncLocalStorage } from "node:async_hooks";
import type { PageProps } from "./page-context.js";

const storage = new AsyncLocalStorage<PageProps>();

export function runPageContext<T>(value: PageProps, render: () => T): T {
  return storage.run(value, render);
}

export function usePageContext<
  TParams extends Record<string, string> = Record<string, string>,
  TSearch extends Record<string, unknown> = Record<string, unknown>,
  TLoaderData = unknown,
>(): PageProps<TParams, TSearch, TLoaderData> {
  const ctx = storage.getStore();
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
