import type {
  ActiveLinkOptions as RouterActiveLinkOptions,
  AnyRouter as RouterAnyRouter,
  LinkComponentProps as RouterLinkComponentProps,
  LinkOptions as RouterLinkOptions,
  LinkProps as RouterLinkProps,
  NavigateOptions as RouterNavigateOptions,
  Redirect as RouterRedirect,
  RedirectOptions as RouterRedirectOptions,
  ToOptions as RouterToOptions,
  UseLinkPropsOptions as RouterUseLinkPropsOptions,
} from "@tanstack/react-router";
import {
  isNotFound,
  isRedirect,
  notFound,
  Link as RouterLink,
  Navigate as RouterNavigate,
  redirect as routerRedirect,
  useLinkProps as useRouterLinkProps,
  useLocation as useRouterLocation,
  useNavigate as useRouterNavigate,
} from "@tanstack/react-router";
import type { ComponentPropsWithRef, ReactElement } from "react";
import type { Register } from "../route/index.js";

type RegisteredAppRouter = Register extends {
  router: infer TRouter extends RouterAnyRouter;
}
  ? TRouter
  : RouterAnyRouter;

export type ToOptions<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterToOptions<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

export type NavigateOptions<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterNavigateOptions<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

export type LinkOptions<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterLinkOptions<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

export type ActiveLinkOptions<
  TComp = "a",
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterActiveLinkOptions<
  TComp,
  RegisteredAppRouter,
  TFrom,
  TTo,
  TMaskFrom,
  TMaskTo
>;

export type LinkProps<
  TComp = "a",
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterLinkProps<TComp, RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

export type UseLinkPropsOptions<
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterUseLinkPropsOptions<
  RegisteredAppRouter,
  TFrom,
  TTo,
  TMaskFrom,
  TMaskTo
>;

export type RedirectOptions<
  TFrom extends string = string,
  TTo extends string | undefined = undefined,
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterRedirectOptions<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

export type Redirect<
  TFrom extends string = string,
  TTo extends string | undefined = undefined,
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterRedirect<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>;

type LinkComponentProps<
  TComp = "a",
  TFrom extends string = string,
  TTo extends string | undefined = ".",
  TMaskFrom extends string = TFrom,
  TMaskTo extends string = ".",
> = RouterLinkComponentProps<
  TComp,
  RegisteredAppRouter,
  TFrom,
  TTo,
  TMaskFrom,
  TMaskTo
>;

type LinkComponent<TComp = "a", TDefaultFrom extends string = string> = <
  const TFrom extends string = TDefaultFrom,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  props: LinkComponentProps<TComp, TFrom, TTo, TMaskFrom, TMaskTo>,
) => ReactElement;

export const Link = RouterLink as LinkComponent<"a">;

export function Navigate<
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(props: NavigateOptions<TFrom, TTo, TMaskFrom, TMaskTo>): null {
  return RouterNavigate<RegisteredAppRouter, TFrom, TTo, TMaskFrom, TMaskTo>(
    props,
  );
}

export function useLinkProps<
  const TFrom extends string = string,
  const TTo extends string | undefined = undefined,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  options: UseLinkPropsOptions<TFrom, TTo, TMaskFrom, TMaskTo>,
): ComponentPropsWithRef<"a"> {
  return useRouterLinkProps<
    RegisteredAppRouter,
    TFrom,
    TTo,
    TMaskFrom,
    TMaskTo
  >(options);
}

export function useNavigate<TDefaultFrom extends string = string>(
  defaultOpts?: Parameters<
    typeof useRouterNavigate<RegisteredAppRouter, TDefaultFrom>
  >[0],
): ReturnType<typeof useRouterNavigate<RegisteredAppRouter, TDefaultFrom>> {
  return useRouterNavigate<RegisteredAppRouter, TDefaultFrom>(defaultOpts);
}

export function useLocation<
  TSelected = unknown,
  TStructuralSharing extends boolean = boolean,
>(
  opts?: Parameters<
    typeof useRouterLocation<RegisteredAppRouter, TSelected, TStructuralSharing>
  >[0],
): ReturnType<
  typeof useRouterLocation<RegisteredAppRouter, TSelected, TStructuralSharing>
> {
  return useRouterLocation<RegisteredAppRouter, TSelected, TStructuralSharing>(
    opts,
  );
}

export function redirect<
  const TTo extends string | undefined = ".",
  const TFrom extends string = string,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(
  opts: RedirectOptions<TFrom, TTo, TMaskFrom, TMaskTo>,
): Redirect<TFrom, TTo, TMaskFrom, TMaskTo> {
  return routerRedirect<RegisteredAppRouter, TTo, TFrom, TMaskFrom, TMaskTo>(
    opts,
  );
}

export { isNotFound, isRedirect, notFound };
