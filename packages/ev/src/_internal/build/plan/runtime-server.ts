import {
  formatConcreteRuntimePathSegmentValidationError,
  getConcreteRuntimePathSegmentValidationError,
  staticRouteSegmentsEqual,
} from "@evjs/shared";
import type {
  CoreClientRouteNode,
  CoreGraph,
  RuntimePlan,
} from "@evjs/shared/manifest";
import { formatCoreRoutePattern } from "./route-pattern.js";

interface RuntimeServerConfig {
  basepath: string;
  runtime: {
    fn: string;
    ppr?: string;
    rsc?: string;
  };
}

export interface RuntimeServerCapabilities {
  hasPpr: boolean;
  hasRsc: boolean;
}

interface ReservedFrameworkServerEndpoint {
  label: string;
  endpoint: string;
  subtree: boolean;
}

export function createRuntimeServerPlan(
  config: RuntimeServerConfig,
  capabilities: RuntimeServerCapabilities,
): RuntimePlan["server"] {
  const ppr = capabilities.hasPpr
    ? (config.runtime.ppr ??
      toRuntimeEndpoint(joinPath(config.basepath, "ppr")))
    : undefined;
  const rsc = capabilities.hasRsc
    ? (config.runtime.rsc ??
      toRuntimeEndpoint(joinPath(config.basepath, "rsc")))
    : undefined;

  const runtimeServer = {
    basepath: config.basepath,
    fn: config.runtime.fn,
    ...(ppr ? { ppr } : {}),
    ...(rsc ? { rsc } : {}),
  };
  validateConcreteRuntimeEndpoint(
    runtimeServer.basepath,
    "runtime.server.basepath",
    "absolute",
  );
  validateConcreteRuntimeEndpoint(
    runtimeServer.fn,
    "runtime.server.fn",
    "relative",
  );
  if (runtimeServer.ppr) {
    validateConcreteRuntimeEndpoint(
      runtimeServer.ppr,
      "runtime.server.ppr",
      "relative",
    );
  }
  if (runtimeServer.rsc) {
    validateConcreteRuntimeEndpoint(
      runtimeServer.rsc,
      "runtime.server.rsc",
      "relative",
    );
  }
  return runtimeServer;
}

export function validateRuntimeEndpointConflicts(
  graph: CoreGraph,
  runtime: RuntimePlan["server"],
): void {
  const reservedEndpoints: ReservedFrameworkServerEndpoint[] = [
    {
      label: "server function endpoint",
      endpoint: runtime.fn,
      subtree: false,
    },
    ...(runtime.rsc
      ? [{ label: "RSC endpoint", endpoint: runtime.rsc, subtree: false }]
      : []),
    ...(runtime.ppr
      ? [{ label: "PPR endpoint", endpoint: runtime.ppr, subtree: true }]
      : []),
  ];
  validateReservedRuntimeEndpoints(reservedEndpoints);

  for (const route of graph.serverRoutes) {
    for (const reserved of reservedEndpoints) {
      if (!serverRouteCanMatchReservedEndpoint(route.path, reserved)) continue;
      throw new Error(
        `[evjs] Server file route module "${route.module}" with path "${route.path}" conflicts with the ${formatReservedEndpoint(reserved)}.`,
      );
    }
  }

  for (const route of graph.routes) {
    if (!isUrlOwningClientRoute(route)) continue;
    for (const reserved of reservedEndpoints) {
      if (!clientRouteCanMatchReservedEndpoint(route.pattern, reserved)) {
        continue;
      }
      throw new Error(
        `[evjs] ${formatUrlOwningClientRoute(route)} with path "${formatCoreRoutePattern(route.pattern)}" conflicts with the ${formatReservedEndpoint(reserved)}.`,
      );
    }
  }
}

export function validateClientServerRouteConflicts(graph: CoreGraph): void {
  for (const route of graph.routes) {
    if (!isUrlOwningClientRoute(route)) continue;

    for (const serverRoute of graph.serverRoutes) {
      if (!clientRouteIntersectsServerRoute(route.pattern, serverRoute.path)) {
        continue;
      }
      throw new Error(
        `[evjs] ${formatUrlOwningClientRoute(route)} with path "${formatCoreRoutePattern(route.pattern)}" conflicts with server request Route module "${serverRoute.module}" with path "${serverRoute.path}". Client and server request Route patterns must be disjoint because server request Routes take precedence at runtime.`,
      );
    }
  }
}

function validateConcreteRuntimeEndpoint(
  endpoint: string,
  field: string,
  form: "absolute" | "relative",
): void {
  if (form === "absolute" && !endpoint.startsWith("/")) {
    throw new Error(`[evjs] ${field} must start with "/".`);
  }
  if (form === "relative" && endpoint.startsWith("/")) {
    throw new Error(`[evjs] ${field} must not start with "/".`);
  }
  const error = getConcreteRuntimePathSegmentValidationError(endpoint);
  if (error) {
    throw new Error(
      `[evjs] ${field} ${formatConcreteRuntimePathSegmentValidationError(error)}`,
    );
  }
}

function isUrlOwningClientRoute(route: CoreClientRouteNode): boolean {
  return route.target.kind !== "group";
}

function formatUrlOwningClientRoute(route: CoreClientRouteNode): string {
  return route.target.kind === "page"
    ? `Page Route "${route.id}" targeting Page "${route.target.pageId}"`
    : `Redirect Route "${route.id}"`;
}

function clientRouteIntersectsServerRoute(
  pattern: CoreClientRouteNode["pattern"],
  serverRoutePath: string,
): boolean {
  const serverSegments = splitPathSegments(serverRoutePath);
  const terminalSplat = pattern.segments.at(-1)?.kind === "splat";
  const fixedClientSegments = terminalSplat
    ? pattern.segments.slice(0, -1)
    : pattern.segments;

  if (
    (!terminalSplat && fixedClientSegments.length !== serverSegments.length) ||
    (terminalSplat && fixedClientSegments.length > serverSegments.length)
  ) {
    return false;
  }

  return fixedClientSegments.every((clientSegment, index) => {
    const serverSegment = serverSegments[index];
    return (
      clientSegment.kind !== "static" ||
      isDynamicPathSegment(serverSegment) ||
      (serverSegment !== undefined &&
        staticRouteSegmentsEqual(clientSegment.value, serverSegment))
    );
  });
}

function validateReservedRuntimeEndpoints(
  reservedEndpoints: ReservedFrameworkServerEndpoint[],
): void {
  const exactEndpoints = reservedEndpoints.filter(
    (reserved) => !reserved.subtree,
  );
  for (let index = 0; index < exactEndpoints.length; index++) {
    const left = exactEndpoints[index];
    if (!left) continue;
    for (const right of exactEndpoints.slice(index + 1)) {
      if (!serverRouteCanMatchReservedEndpoint(left.endpoint, right)) continue;
      throw new Error(
        `[evjs] Framework runtime ${left.label} "${formatRuntimeEndpointPath(left.endpoint)}" conflicts with the ${right.label} "${formatRuntimeEndpointPath(right.endpoint)}". Active framework runtime endpoints must not match the same request path.`,
      );
    }
  }

  const subtreeEndpoint = reservedEndpoints.find(
    (reserved) => reserved.subtree,
  );
  if (!subtreeEndpoint) return;
  for (const exact of exactEndpoints) {
    if (!serverRouteCanMatchReservedEndpoint(exact.endpoint, subtreeEndpoint)) {
      continue;
    }
    throw new Error(
      `[evjs] Framework runtime ${exact.label} "${formatRuntimeEndpointPath(exact.endpoint)}" conflicts with the ${formatReservedEndpoint(subtreeEndpoint)}. Active exact endpoints must stay outside the PPR subtree.`,
    );
  }
}

function formatReservedEndpoint(
  reserved: ReservedFrameworkServerEndpoint,
): string {
  const reservedPath = formatRuntimeEndpointPath(reserved.endpoint);
  return reserved.subtree
    ? `reserved framework ${reserved.label} subtree rooted at "${reservedPath}"`
    : `reserved framework ${reserved.label} "${reservedPath}"`;
}

function serverRouteCanMatchReservedEndpoint(
  routePath: string,
  reserved: ReservedFrameworkServerEndpoint,
): boolean {
  const routeSegments = splitPathSegments(routePath);
  const endpointSegments = splitPathSegments(reserved.endpoint);
  if (reserved.subtree) {
    if (routeSegments.length < endpointSegments.length) return false;
  } else if (routeSegments.length !== endpointSegments.length) {
    return false;
  }

  return endpointSegments.every((endpointSegment, index) => {
    const routeSegment = routeSegments[index];
    return (
      (routeSegment !== undefined &&
        staticRouteSegmentsEqual(routeSegment, endpointSegment)) ||
      isDynamicPathSegment(routeSegment)
    );
  });
}

function clientRouteCanMatchReservedEndpoint(
  pattern: CoreClientRouteNode["pattern"],
  reserved: ReservedFrameworkServerEndpoint,
): boolean {
  const endpointSegments = splitPathSegments(reserved.endpoint);
  const terminalSplat = pattern.segments.at(-1)?.kind === "splat";
  const fixedSegments = terminalSplat
    ? pattern.segments.slice(0, -1)
    : pattern.segments;

  if (reserved.subtree) {
    if (!terminalSplat && fixedSegments.length < endpointSegments.length) {
      return false;
    }
  } else if (
    (!terminalSplat && fixedSegments.length !== endpointSegments.length) ||
    (terminalSplat && fixedSegments.length > endpointSegments.length)
  ) {
    return false;
  }

  const comparedLength = Math.min(
    fixedSegments.length,
    endpointSegments.length,
  );
  for (let index = 0; index < comparedLength; index++) {
    const routeSegment = fixedSegments[index];
    const endpointSegment = endpointSegments[index];
    if (
      routeSegment?.kind === "static" &&
      (endpointSegment === undefined ||
        !staticRouteSegmentsEqual(routeSegment.value, endpointSegment))
    ) {
      return false;
    }
  }
  return true;
}

function splitPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function isDynamicPathSegment(segment: string | undefined): boolean {
  return segment?.startsWith(":") === true || segment?.includes("*") === true;
}

function formatRuntimeEndpointPath(endpoint: string): string {
  const segments = splitPathSegments(endpoint);
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function joinPath(base: string, segment: string): string {
  return `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`;
}

function toRuntimeEndpoint(pathname: string): string {
  return pathname.startsWith("/") ? pathname.slice(1) : pathname;
}
