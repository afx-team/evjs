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
export const PAGE_ROUTE_CONVENTION_DOCS_URL =
  "https://evaijs.github.io/evjs/docs/file-conventions#client-page-routes";
export const PAGE_ROUTE_CONVENTION_RULES = [
  {
    id: "directory-index",
    category: "route",
    summary: "index files for directory roots",
    valid: ["index.tsx", "users/index.tsx"],
    invalid: ["users.tsx plus users/index.tsx for the same path"],
  },
  {
    id: "dynamic-segment",
    category: "route",
    summary: "$param filenames for dynamic segments",
    valid: ["users/$userId.tsx"],
    invalid: [
      "users/[userId].tsx",
      "users/$123.tsx",
      "files/$...path.tsx",
      "users/$__proto__.tsx",
      "docs/$_splat.tsx",
    ],
  },
  {
    id: "unique-path",
    category: "route",
    summary: "one page file per URL path",
    valid: ["users.tsx", "users/index.tsx"],
    invalid: ["users.tsx plus users/index.tsx for /users"],
  },
  {
    id: "unique-dynamic-shape",
    category: "route",
    summary: "one dynamic param name per URL shape",
    valid: ["users/$id.tsx"],
    invalid: ["users/$id.tsx plus users/$userId.tsx"],
  },
  {
    id: "unique-route-id",
    category: "route",
    summary: "unique generated route ids",
    valid: ["admin/panel.tsx"],
    invalid: ["admin/panel.tsx plus admin_panel.tsx"],
  },
  {
    id: "route-group",
    category: "route",
    summary: "route groups for pathless organization",
    valid: ["(marketing)/about.tsx", "(app)/dashboard/layout.tsx"],
    invalid: [],
  },
  {
    id: "static-segment",
    category: "route",
    summary: "lowercase URL-safe static segments",
    valid: ["about.tsx", "docs/api-v1.tsx"],
    invalid: ["About.tsx", "contact us.tsx"],
  },
  {
    id: "private-module",
    category: "ignored",
    summary: "_-prefixed private modules",
    valid: ["_helpers/format.ts", "posts/_draft.tsx"],
    invalid: [],
  },
  {
    id: "hidden-module",
    category: "ignored",
    summary: "dot-prefixed hidden modules",
    valid: [".draft.tsx", ".hidden/secret.tsx"],
    invalid: [],
  },
  {
    id: "declaration-module",
    category: "ignored",
    summary: "declaration files",
    valid: ["env.d.ts", "route-types.d.ts"],
    invalid: [],
  },
  {
    id: "test-module",
    category: "ignored",
    summary: "test/spec modules",
    valid: ["about.test.tsx", "users.spec.ts"],
    invalid: [],
  },
  {
    id: "story-module",
    category: "ignored",
    summary: "Storybook modules",
    valid: ["profile.story.tsx", "profile.stories.tsx"],
    invalid: [],
  },
  {
    id: "client-module",
    category: "ignored",
    summary: "client-only *.client.* modules",
    valid: ["ClientCard.client.tsx", "widgets/menu.client.tsx"],
    invalid: [],
  },
  {
    id: "server-module",
    category: "ignored",
    summary: "server-only *.server.* modules",
    valid: ["users.server.ts", "posts/actions.server.ts"],
    invalid: [],
  },
  {
    id: "root-layout",
    category: "layout",
    summary:
      "SPA root layout auto-discovery uses one layout/index.tsx module beside the route directory",
    valid: ["src/layout/index.tsx"],
    invalid: ["src/layout.tsx", "src/layout/index.jsx", "src/pages/layout.tsx"],
  },
  {
    id: "route-layout",
    category: "layout",
    summary: "nested SPA route layouts use layout source modules below a route",
    valid: ["src/pages/posts/layout.tsx"],
    invalid: ["src/pages/layout.tsx", "src/pages/posts/layout/index.tsx"],
  },
  {
    id: "error-boundary",
    category: "boundary",
    summary:
      "SPA error boundaries use error source modules scoped by directory",
    valid: ["src/pages/error.tsx", "src/pages/posts/error.tsx"],
    invalid: ["src/pages/error/index.tsx"],
  },
  {
    id: "not-found-boundary",
    category: "boundary",
    summary:
      "SPA not-found boundaries use not-found source modules scoped by directory",
    valid: ["src/pages/not-found.tsx", "src/pages/posts/not-found.tsx"],
    invalid: ["src/pages/not-found/index.tsx"],
  },
  {
    id: "mpa-html-template",
    category: "html",
    summary:
      "MPA page routes can use colocated HTML templates with the same basename",
    valid: [
      "about.html beside about.tsx",
      "users/index.html beside users/index.tsx",
    ],
    invalid: [],
  },
] as const satisfies readonly PageRouteConventionRule[];
export const PAGE_ROUTE_CONVENTION_SUMMARY = formatPageRouteConventionSummary(
  PAGE_ROUTE_CONVENTION_RULES,
);
export const PAGE_ROUTE_ROOT_LAYOUT_FILE = path.join("layout", "index.tsx");
export const PAGE_ROUTE_UNSUPPORTED_ROOT_LAYOUT_FILES = [
  "layout.tsx",
  "layout.ts",
  "layout.jsx",
  "layout.js",
  "layout/index.ts",
  "layout/index.jsx",
  "layout/index.js",
] as const;

const PAGE_ROUTE_SOURCE_EXTENSION_SET = new Set<string>(
  PAGE_ROUTE_SOURCE_EXTENSIONS,
);
const STATIC_ROUTE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._~-]*$/;
const DYNAMIC_ROUTE_PARAM_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

export interface PageRouteFileConvention {
  segments: string[];
}

export interface PageRouteShape {
  key: string;
  label: string;
}

export interface PageRouteConventionRule {
  id:
    | "directory-index"
    | "dynamic-segment"
    | "unique-path"
    | "unique-dynamic-shape"
    | "unique-route-id"
    | "route-group"
    | "static-segment"
    | "private-module"
    | "hidden-module"
    | "declaration-module"
    | "test-module"
    | "story-module"
    | "client-module"
    | "server-module"
    | "root-layout"
    | "route-layout"
    | "error-boundary"
    | "not-found-boundary"
    | "mpa-html-template";
  category: "route" | "ignored" | "layout" | "boundary" | "html";
  summary: string;
  valid: readonly string[];
  invalid: readonly string[];
}

export interface InvalidPageRouteSegment {
  kind: "duplicate-dynamic" | "dynamic" | "reserved-dynamic" | "static";
  segment: string;
}

export type PageRouteSegmentConventionViolation =
  | { kind: "route-group"; segment: string }
  | { kind: "bracket"; segment: string }
  | { kind: "unsupported-dynamic"; segment: string }
  | InvalidPageRouteSegment;

function formatPageRouteConventionSummary(
  rules: readonly PageRouteConventionRule[],
): string {
  const routeFileRules = rules
    .filter((rule) => rule.category === "route")
    .map((rule) => rule.summary);
  const ignoredRules = rules
    .filter((rule) => rule.category === "ignored")
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
    `Page route files use ${joinConventionSummaryList(routeFileRules)}`,
  ];
  if (ignoredRules.length > 0) {
    sections.push(
      `ignored colocated modules include ${joinConventionSummaryList(ignoredRules)}`,
    );
  }
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

export function parsePageRouteFile(
  routeRel: string,
  options: { spaConventions?: boolean } = {},
): PageRouteFileConvention | undefined {
  const normalizedRouteRel = normalizePageRouteConventionPath(routeRel);
  if (!isPageRouteSourceModuleFile(path.posix.basename(normalizedRouteRel))) {
    return undefined;
  }

  const extension = path.posix.extname(normalizedRouteRel);
  const withoutExt = normalizedRouteRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some(isIgnoredPageRouteSegment)) return undefined;

  const name = segments[segments.length - 1] ?? "";
  if (
    options.spaConventions !== false &&
    isPageRouteConventionModuleName(name)
  ) {
    return undefined;
  }
  const routeSegments = name === "index" ? segments.slice(0, -1) : segments;
  return { segments: routeSegments };
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
): string | undefined {
  return segments.find(
    (segment) =>
      segment.startsWith("$") &&
      (segment === "$" || segment.startsWith("$...") || segment.endsWith("?")),
  );
}

export function findInvalidRouteSegment(
  segments: string[],
): InvalidPageRouteSegment | undefined {
  const dynamicNames = new Set<string>();
  for (const segment of segments) {
    if (isPageRouteGroupSegment(segment)) continue;

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

    if (!STATIC_ROUTE_SEGMENT_PATTERN.test(segment)) {
      return { kind: "static", segment };
    }
  }

  return undefined;
}

export function findPageRouteSegmentConventionViolation(
  segments: string[],
): PageRouteSegmentConventionViolation | undefined {
  const routeGroupSegment = findRouteGroupSegment(segments);
  if (routeGroupSegment) {
    return { kind: "route-group", segment: routeGroupSegment };
  }

  const bracketSegment = findBracketRouteSegment(segments);
  if (bracketSegment) return { kind: "bracket", segment: bracketSegment };

  const unsupportedDynamicSegment =
    findUnsupportedDynamicRouteSegment(segments);
  if (unsupportedDynamicSegment) {
    return {
      kind: "unsupported-dynamic",
      segment: unsupportedDynamicSegment,
    };
  }

  return findInvalidRouteSegment(segments);
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
      ? ` Rename the file to "$${name}" for a dynamic segment, or use explicit pages config for a custom URL.`
      : " Use explicit pages config for catch-all or custom URL shapes.";
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
    return `Catch-all page route segments are not supported. Use explicit pages config for wildcard or custom URL shapes instead of "${segment}".`;
  }
  if (segment.endsWith("?")) {
    return `Optional page route segments are not supported. Split the route into explicit files or use explicit pages config instead of "${segment}".`;
  }
  return `Unsupported dynamic page route segment "${segment}".`;
}

function formatInvalidRouteSegmentViolation(
  invalid: InvalidPageRouteSegment,
): string {
  if (invalid.kind === "dynamic") {
    return `Dynamic page route segment "${invalid.segment}" must use a JavaScript identifier after "$", such as "$userId".`;
  }
  if (invalid.kind === "reserved-dynamic") {
    return `Dynamic page route segment "${invalid.segment}" uses a reserved param name. Use a safe application-specific name such as "$userId".`;
  }
  if (invalid.kind === "duplicate-dynamic") {
    return `Dynamic page route segment "${invalid.segment}" repeats a param name. Use unique dynamic param filenames within one route path.`;
  }

  return `Static page route segment "${invalid.segment}" must use lowercase URL-safe characters: lowercase letters, numbers, ".", "_", "-", or "~". Rename the file to a lowercase URL-safe segment, or use explicit pages config for custom paths.`;
}

export function routePathFromSegments(segments: string[]): string {
  const pathSegments = segments.filter(
    (segment) => !isPageRouteGroupSegment(segment),
  );
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
