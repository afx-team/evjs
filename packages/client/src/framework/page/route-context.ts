import { useMatches } from "@tanstack/react-router";

function mergeActiveRouteParams(
  matches: readonly { params: unknown }[],
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const match of matches) {
    if (match.params && typeof match.params === "object") {
      Object.assign(params, match.params);
    }
  }
  return params;
}

/**
 * Read the merged params for the active SPA route branch.
 *
 * Unlike Page-scoped data hooks, this hook is available to root and route
 * layouts because it reads the Router's active matches directly.
 */
export function useRouteParams<
  TParams extends Record<string, string | undefined> = Record<string, string>,
>(): TParams {
  return useMatches({
    select: mergeActiveRouteParams,
    structuralSharing: true,
  }) as TParams;
}
