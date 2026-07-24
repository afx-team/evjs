import path from "node:path";
import {
  getPageRouteParamNameValidationError,
  pageRoutePathShapeFromPath,
} from "@evjs/shared";

export const PAGE_ROUTE_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
] as const;
export const PAGE_ROUTE_SOURCE_EXTENSION_LABEL = ".ts, .tsx, .js, or .jsx";
export const PAGE_ENTRY_BASENAME = "page";
export const PAGE_ENTRY_FILES = PAGE_ROUTE_SOURCE_EXTENSIONS.map(
  (extension) => `${PAGE_ENTRY_BASENAME}${extension}`,
);
export const PAGE_ENTRY_LABEL = "page.ts, page.tsx, page.js, or page.jsx";
export const PAGE_CONFIG_FILES = ["page.config.ts", "page.config.js"] as const;
export const PAGE_CONFIG_LABEL = "page.config.ts or page.config.js";
export const PAGE_ROUTE_CONVENTION_DOCS_URL =
  "https://evaijs.github.io/evjs/docs/file-conventions#client-page-routes";
export const PAGE_ANCHOR_ROUTE_CONVENTION_RULES = [
  {
    id: "page-anchor",
    category: "route",
    summary: `exactly one ${PAGE_ENTRY_LABEL} anchor per route directory`,
    valid: ["page.tsx", "users/page.tsx"],
    invalid: ["page.ts plus page.tsx in the same route directory"],
  },
  {
    id: "dynamic-segment",
    category: "route",
    summary:
      "static, $param, terminal $...splat, and pathless (group) directory segments",
    valid: [
      "users/$userId/page.tsx",
      "files/$...splat/page.tsx",
      "(admin)/settings/page.tsx",
    ],
    invalid: ["users/[userId]/page.tsx", "files/$...path/edit/page.tsx"],
  },
  {
    id: "unique-path",
    category: "route",
    summary: "one Page anchor per normalized URL path",
    valid: ["users/page.tsx"],
    invalid: ["users/page.tsx plus (group)/users/page.tsx for /users"],
  },
  {
    id: "unique-dynamic-shape",
    category: "route",
    summary: "one dynamic parameter name per URL shape",
    valid: ["users/$id/page.tsx"],
    invalid: ["users/$id/page.tsx plus users/$userId/page.tsx"],
  },
  {
    id: "unique-route-id",
    category: "route",
    summary: "unique generated route ids",
    valid: ["admin/panel/page.tsx"],
    invalid: ["admin/panel/page.tsx plus admin_panel/page.tsx"],
  },
  {
    id: "ordinary-module",
    category: "ordinary",
    summary:
      "every non-anchor, non-facet source file remains ordinary application or Page code",
    valid: ["model.ts", "components/Card.tsx", "index.tsx"],
    invalid: [],
  },
  {
    id: "page-config",
    category: "config",
    summary:
      "optional build-time Page configuration uses one colocated page.config.ts or page.config.js module",
    valid: ["src/pages/page.config.ts", "src/pages/users/page.config.ts"],
    invalid: [
      "src/pages/page.config.ts plus src/pages/page.config.js in the same Page directory",
    ],
  },
  {
    id: "root-layout",
    category: "layout",
    summary:
      "the root route layout uses one layout source module in the routing root",
    valid: ["src/pages/layout.tsx"],
    invalid: ["src/pages/layout.ts plus src/pages/layout.tsx"],
  },
  {
    id: "route-layout",
    category: "layout",
    summary:
      "nested route layouts use layout source modules in route directories",
    valid: ["src/pages/posts/layout.tsx"],
    invalid: ["src/pages/posts/layout.ts plus src/pages/posts/layout.tsx"],
  },
  {
    id: "error-boundary",
    category: "boundary",
    summary: "error boundaries use error source modules scoped by directory",
    valid: ["src/pages/error.tsx", "src/pages/posts/error.tsx"],
    invalid: [],
  },
  {
    id: "not-found-boundary",
    category: "boundary",
    summary:
      "not-found boundaries use not-found source modules scoped by directory",
    valid: ["src/pages/not-found.tsx", "src/pages/posts/not-found.tsx"],
    invalid: [],
  },
] as const satisfies readonly PageRouteConventionRule[];
export const PAGE_ANCHOR_ROUTE_CONVENTION_SUMMARY =
  formatPageRouteConventionSummary(
    PAGE_ANCHOR_ROUTE_CONVENTION_RULES,
    "Page-anchor routes use",
  );

const PAGE_ROUTE_SOURCE_EXTENSION_SET = new Set<string>(
  PAGE_ROUTE_SOURCE_EXTENSIONS,
);
const CASE_PRESERVING_STATIC_ROUTE_SEGMENT_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const LOWERCASE_STATIC_ROUTE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const DYNAMIC_ROUTE_PARAM_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const CATCH_ALL_ROUTE_PARAM_PATTERN = /^\$\.\.\.[A-Za-z_][A-Za-z0-9_]*$/;

export interface PageRouteFileConvention {
  segments: string[];
}

export interface PageRouteShape {
  key: string;
  label: string;
}

export interface PageRouteConventionRule {
  id:
    | "page-anchor"
    | "page-config"
    | "ordinary-module"
    | "dynamic-segment"
    | "unique-path"
    | "unique-dynamic-shape"
    | "unique-route-id"
    | "route-group"
    | "static-segment"
    | "declaration-module"
    | "test-module"
    | "story-module"
    | "client-module"
    | "server-module"
    | "root-layout"
    | "route-layout"
    | "error-boundary"
    | "not-found-boundary";
  category:
    | "route"
    | "ignored"
    | "ordinary"
    | "config"
    | "layout"
    | "boundary"
    | "html";
  summary: string;
  valid: readonly string[];
  invalid: readonly string[];
}

export interface InvalidPageRouteSegment {
  kind:
    | "catch-all"
    | "duplicate-catch-all"
    | "duplicate-dynamic"
    | "dynamic"
    | "non-terminal-catch-all"
    | "reserved-catch-all"
    | "reserved-dynamic"
    | "static";
  segment: string;
}

export interface PageRouteSegmentConventionOptions {
  allowCasePreservingStatic?: boolean;
  allowCatchAll?: boolean;
}

export type PageRouteSegmentConventionViolation =
  | { kind: "route-group"; segment: string }
  | { kind: "bracket"; segment: string }
  | { kind: "unsupported-dynamic"; segment: string }
  | InvalidPageRouteSegment;

function formatPageRouteConventionSummary(
  rules: readonly PageRouteConventionRule[],
  routePrefix = "Page route files use",
): string {
  const routeFileRules = rules
    .filter((rule) => rule.category === "route")
    .map((rule) => rule.summary);
  const ignoredRules = rules
    .filter((rule) => rule.category === "ignored")
    .map((rule) => rule.summary);
  const ordinaryRules = rules
    .filter((rule) => rule.category === "ordinary")
    .map((rule) => rule.summary);
  const configRules = rules
    .filter((rule) => rule.category === "config")
    .map((rule) => rule.summary);
  const layoutRules = rules
    .filter((rule) => rule.category === "layout")
    .map((rule) => rule.summary);
  const boundaryRules = rules
    .filter((rule) => rule.category === "boundary")
    .map((rule) => rule.summary);
  const htmlRules = rules
    .filter((rule) => rule.category === "html")
    .map((rule) => rule.summary);

  const sections = [
    `${routePrefix} ${joinConventionSummaryList(routeFileRules)}`,
  ];
  if (ignoredRules.length > 0) {
    sections.push(
      `ignored colocated modules include ${joinConventionSummaryList(ignoredRules)}`,
    );
  }
  sections.push(...ordinaryRules);
  sections.push(...configRules);
  sections.push(...layoutRules);
  sections.push(...boundaryRules);
  sections.push(...htmlRules);
  return sections.join("; ");
}

function joinConventionSummaryList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function isPageRouteSourceModuleFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  if (/\.(client|server)\.[jt]sx?$/.test(file)) return false;
  if (/\.(test|spec|story|stories)\.[cm]?[jt]sx?$/.test(file)) return false;
  return PAGE_ROUTE_SOURCE_EXTENSION_SET.has(path.extname(file));
}

export function normalizePageRouteConventionPath(routeRel: string): string {
  return routeRel.replaceAll("\\", "/");
}

export function parsePageAnchorRouteFile(
  routeRel: string,
): PageRouteFileConvention | undefined {
  const normalizedRouteRel = normalizePageRouteConventionPath(routeRel);
  if (!isPageRouteSourceModuleFile(path.posix.basename(normalizedRouteRel))) {
    return undefined;
  }

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.at(-1) !== PAGE_ENTRY_BASENAME) return undefined;
  return { segments: segments.slice(0, -1) };
}

export function isPageRouteConventionModuleName(name: string): boolean {
  return name === "error" || name === "not-found";
}

export function isPrivatePageRouteSegment(segment: string): boolean {
  return segment.startsWith("_");
}

export function isHiddenPageRouteSegment(segment: string): boolean {
  return segment.startsWith(".");
}

export function isIgnoredPageRouteSegment(segment: string): boolean {
  return (
    isHiddenPageRouteSegment(segment) || isPrivatePageRouteSegment(segment)
  );
}

export function findRouteGroupSegment(segments: string[]): string | undefined {
  return segments.find(
    (segment) =>
      (segment.startsWith("(") || segment.endsWith(")")) &&
      !isPageRouteGroupSegment(segment),
  );
}

export function isPageRouteGroupSegment(segment: string): boolean {
  return /^\([^)]+\)$/.test(segment);
}

export function findBracketRouteSegment(
  segments: string[],
): string | undefined {
  return segments.find(
    (segment) => segment.startsWith("[") || segment.endsWith("]"),
  );
}

export function findUnsupportedDynamicRouteSegment(
  segments: string[],
  options: PageRouteSegmentConventionOptions = {},
): string | undefined {
  const allowCatchAll = options.allowCatchAll !== false;
  return segments.find(
    (segment) =>
      segment.startsWith("$") &&
      (segment === "$" ||
        (!allowCatchAll && isCatchAllPageRouteSegment(segment)) ||
        segment.endsWith("?")),
  );
}

export function findInvalidRouteSegment(
  segments: string[],
  options: PageRouteSegmentConventionOptions = {},
): InvalidPageRouteSegment | undefined {
  const dynamicNames = new Set<string>();
  const staticSegmentPattern =
    options.allowCasePreservingStatic === false
      ? LOWERCASE_STATIC_ROUTE_SEGMENT_PATTERN
      : CASE_PRESERVING_STATIC_ROUTE_SEGMENT_PATTERN;
  let lastRouteSegmentIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!isPageRouteGroupSegment(segments[index])) {
      lastRouteSegmentIndex = index;
      break;
    }
  }
  let hasCatchAll = false;
  for (const [index, segment] of segments.entries()) {
    if (isPageRouteGroupSegment(segment)) continue;

    if (isCatchAllPageRouteSegment(segment)) {
      if (options.allowCatchAll === false) {
        return { kind: "catch-all", segment };
      }
      if (!CATCH_ALL_ROUTE_PARAM_PATTERN.test(segment)) {
        return { kind: "catch-all", segment };
      }
      const name = getCatchAllRouteParamName(segment);
      if (getPageRouteParamNameValidationError(name) === "reserved") {
        return { kind: "reserved-catch-all", segment };
      }
      if (index !== lastRouteSegmentIndex) {
        return { kind: "non-terminal-catch-all", segment };
      }
      if (hasCatchAll) return { kind: "duplicate-catch-all", segment };
      hasCatchAll = true;
      continue;
    }

    if (segment.startsWith("$")) {
      if (!DYNAMIC_ROUTE_PARAM_PATTERN.test(segment)) {
        return { kind: "dynamic", segment };
      }
      const name = segment.slice(1);
      if (getPageRouteParamNameValidationError(name) === "reserved") {
        return { kind: "reserved-dynamic", segment };
      }
      if (dynamicNames.has(name)) return { kind: "duplicate-dynamic", segment };
      dynamicNames.add(name);
      continue;
    }

    if (!staticSegmentPattern.test(segment)) {
      return { kind: "static", segment };
    }
  }

  return undefined;
}

export function findPageRouteSegmentConventionViolation(
  segments: string[],
  options: PageRouteSegmentConventionOptions = {},
): PageRouteSegmentConventionViolation | undefined {
  const routeGroupSegment = findRouteGroupSegment(segments);
  if (routeGroupSegment) {
    return { kind: "route-group", segment: routeGroupSegment };
  }

  const bracketSegment = findBracketRouteSegment(segments);
  if (bracketSegment) return { kind: "bracket", segment: bracketSegment };

  const unsupportedDynamicSegment = findUnsupportedDynamicRouteSegment(
    segments,
    options,
  );
  if (unsupportedDynamicSegment) {
    return {
      kind: "unsupported-dynamic",
      segment: unsupportedDynamicSegment,
    };
  }

  return findInvalidRouteSegment(segments, options);
}

export function formatPageRouteSegmentConventionViolation(
  violation: PageRouteSegmentConventionViolation,
): string {
  if (violation.kind === "route-group") {
    return formatRouteGroupSegmentViolation(violation.segment);
  }
  if (violation.kind === "bracket") {
    return formatBracketRouteSegmentViolation(violation.segment);
  }
  if (violation.kind === "unsupported-dynamic") {
    return formatUnsupportedDynamicRouteSegmentViolation(violation.segment);
  }
  return formatInvalidRouteSegmentViolation(violation);
}

function formatBracketRouteSegmentViolation(segment: string): string {
  const name = segment.replace(/^\[+/, "").replace(/\]+$/, "");
  const suggestion =
    name && !name.startsWith("...")
      ? ` Rename the route directory to "$${name}" for a dynamic segment.`
      : ' Use a terminal "$...splat" route directory for a catch-all.';
  return `Dynamic page route segments must use $param filenames. Bracket segment "${segment}" is not supported.${suggestion}`;
}

function formatRouteGroupSegmentViolation(segment: string): string {
  return `Page route group segment "${segment}" must wrap a non-empty group name in parentheses, such as "(marketing)".`;
}

function formatUnsupportedDynamicRouteSegmentViolation(
  segment: string,
): string {
  if (segment === "$") {
    return 'Dynamic page route segments must include a name after "$". Segment "$" is not supported.';
  }
  if (segment.startsWith("$...")) {
    return `Catch-all page route segments are not supported in this topology. Use routing.mode "spa" or replace "${segment}" with static Page directories.`;
  }
  if (segment.endsWith("?")) {
    return `Optional page route segments are not supported. Split "${segment}" into separate Page directories.`;
  }
  return `Unsupported dynamic page route segment "${segment}".`;
}

function formatInvalidRouteSegmentViolation(
  invalid: InvalidPageRouteSegment,
): string {
  if (invalid.kind === "catch-all") {
    return `Catch-all page route segment "${invalid.segment}" must use a JavaScript identifier after "$...", such as "$...splat".`;
  }
  if (invalid.kind === "reserved-catch-all") {
    return `Catch-all page route segment "${invalid.segment}" uses a reserved param name. Use a safe application-specific name such as "$...splat"; runtime wildcard params are exposed as "_splat".`;
  }
  if (invalid.kind === "duplicate-catch-all") {
    return `Catch-all page route segment "${invalid.segment}" repeats a wildcard route segment. Use at most one catch-all segment within one route path.`;
  }
  if (invalid.kind === "non-terminal-catch-all") {
    return `Catch-all page route segment "${invalid.segment}" must be the final URL path segment. Move it to the end of the route path, or split the route into explicit files.`;
  }
  if (invalid.kind === "dynamic") {
    return `Dynamic page route segment "${invalid.segment}" must use a JavaScript identifier after "$", such as "$userId".`;
  }
  if (invalid.kind === "reserved-dynamic") {
    return `Dynamic page route segment "${invalid.segment}" uses a reserved param name. Use a safe application-specific name such as "$userId".`;
  }
  if (invalid.kind === "duplicate-dynamic") {
    return `Dynamic page route segment "${invalid.segment}" repeats a param name. Use unique dynamic param filenames within one route path.`;
  }

  return `Static page route segment "${invalid.segment}" must use URL-safe characters: letters, numbers, ".", "_", "-", or "~". Rename the route directory to a URL-safe segment.`;
}

export function routePathFromSegments(segments: string[]): string {
  const pathSegments = segments
    .filter((segment) => !isPageRouteGroupSegment(segment))
    .map(routePathSegmentFromConventionSegment);
  if (pathSegments.length === 0) return "/";
  return `/${pathSegments.join("/")}`;
}

export function routeIdPathFromSegments(segments: string[]): string {
  const pathSegments = segments
    .filter((segment) => !isPageRouteGroupSegment(segment))
    .map(routeIdSegmentFromConventionSegment);
  if (pathSegments.length === 0) return "/";
  return `/${pathSegments.join("/")}`;
}

export function routeShapeFromSegments(segments: string[]): PageRouteShape {
  return routePathShapeFromPath(routePathFromSegments(segments));
}

export function routePathShapeFromPath(routePath: string): PageRouteShape {
  const shape = pageRoutePathShapeFromPath(routePath);
  return {
    key: shape,
    label: shape,
  };
}

export function isCatchAllPageRouteSegment(segment: string): boolean {
  return segment.startsWith("$...");
}

function routePathSegmentFromConventionSegment(segment: string): string {
  return isCatchAllPageRouteSegment(segment) ? "$" : segment;
}

function routeIdSegmentFromConventionSegment(segment: string): string {
  return isCatchAllPageRouteSegment(segment)
    ? `$${getCatchAllRouteParamName(segment)}`
    : segment;
}

function getCatchAllRouteParamName(segment: string): string {
  return segment.slice("$...".length);
}
