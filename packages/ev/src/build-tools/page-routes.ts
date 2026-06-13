import fs from "node:fs/promises";
import path from "node:path";
import type { PageRouteNode } from "@evjs/shared/manifest";
import {
  getParseErrorMessage,
  hasDefaultExport,
  parseRouteModuleWithError,
} from "./routes/shared.js";

export interface DiscoverPageRoutesOptions {
  dir: string;
  rootLayout?: boolean;
}

export interface PageRouteDiscoveryDiagnostic {
  level: "warning" | "error";
  message: string;
  file?: string;
}

export interface PageRouteDiscovery {
  routes: PageRouteNode[];
  rootModule?: string;
  files: string[];
  diagnostics: PageRouteDiscoveryDiagnostic[];
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ROOT_LAYOUT_FILE = "layout.tsx";
const ROOT_LAYOUT_ALIAS_FILES = [
  "layout.ts",
  "layout.js",
  "layout.jsx",
  "layout/index.ts",
  "layout/index.tsx",
  "layout/index.js",
  "layout/index.jsx",
] as const;

export async function discoverPageRoutes(
  cwd: string,
  options: DiscoverPageRoutesOptions,
): Promise<PageRouteDiscovery> {
  const absoluteDir = path.resolve(cwd, options.dir);
  const files = await collectSourceFiles(cwd, absoluteDir);
  const routes: PageRouteNode[] = [];
  const diagnostics: PageRouteDiscoveryDiagnostic[] = [];
  const rootModule =
    options.rootLayout === false
      ? undefined
      : await discoverRootLayout(cwd, absoluteDir, diagnostics);
  const routeByPath = new Map<string, string>();

  for (const file of files) {
    const sourceRel = toProjectPath(cwd, file);
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    const routeFile = toRouteFile(routeRel);
    if (routeFile?.segments.includes("layout")) {
      diagnostics.push({
        level: "error",
        file: sourceRel.replace(/^\.\//, ""),
        message: createPageLayoutDiagnostic(cwd, absoluteDir),
      });
      continue;
    }

    if (!routeFile) continue;

    const bracketSegment = findBracketRouteSegment(routeFile.segments);
    if (bracketSegment) {
      diagnostics.push({
        level: "error",
        file: sourceRel.replace(/^\.\//, ""),
        message: createBracketRouteSegmentDiagnostic(bracketSegment),
      });
      continue;
    }

    const routePath = routePathFromSegments(routeFile.segments);
    const validRouteModule = await validateDefaultExport(file, diagnostics, {
      file: sourceRel,
      parseError: "Page route module could not be parsed",
      missingDefaultExport: createPageRouteDefaultExportDiagnostic(),
    });
    if (!validRouteModule) continue;

    const previous = routeByPath.get(routePath);
    if (previous) {
      diagnostics.push({
        level: "error",
        file: sourceRel.replace(/^\.\//, ""),
        message: `Duplicate page route path "${routePath}" also declared by ${previous}.`,
      });
      continue;
    }

    routeByPath.set(routePath, sourceRel);
    routes.push({
      id: routeIdFromPath(routePath),
      path: routePath,
      module: sourceRel,
    });
  }

  return {
    routes: routes.sort(compareRoutes),
    rootModule,
    files,
    diagnostics,
  };
}

function createPageLayoutDiagnostic(
  cwd: string,
  absoluteRouteDir: string,
): string {
  const expected = toProjectPath(
    cwd,
    path.join(path.dirname(absoluteRouteDir), ROOT_LAYOUT_FILE),
  );
  return `Layout files must live at ${expected}. Files or folders named layout inside the page route directory are not route pages.`;
}

function createBracketRouteSegmentDiagnostic(segment: string): string {
  return `Dynamic page route segments must use $param filenames. Bracket segment "${segment}" is not supported.`;
}

function createPageRouteDefaultExportDiagnostic(): string {
  return "Page route modules must default-export a React component. Move non-route helpers under an underscore-prefixed file or folder.";
}

function createRootLayoutDefaultExportDiagnostic(): string {
  return "Root layout must default-export a React component.";
}

async function discoverRootLayout(
  cwd: string,
  absoluteRouteDir: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const appDir = path.dirname(absoluteRouteDir);
  if (!isInsideCwd(cwd, appDir)) return undefined;

  const absolute = path.join(appDir, ROOT_LAYOUT_FILE);
  const expected = toProjectPath(cwd, absolute);

  for (const alias of ROOT_LAYOUT_ALIAS_FILES) {
    const aliased = path.join(appDir, alias);
    const actual = toProjectPath(cwd, aliased);
    try {
      await fs.access(aliased);
      diagnostics.push({
        level: "error",
        file: actual.replace(/^\.\//, ""),
        message: `Root layout must be a single file at ${expected}. ${actual} is not supported.`,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  try {
    await fs.access(absolute);
    const validRootLayout = await validateDefaultExport(absolute, diagnostics, {
      file: expected,
      parseError: "Root layout module could not be parsed",
      missingDefaultExport: createRootLayoutDefaultExportDiagnostic(),
    });
    if (!validRootLayout) return undefined;
    return toProjectPath(cwd, absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return undefined;
}

async function validateDefaultExport(
  absolute: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
  messages: {
    file: string;
    parseError: string;
    missingDefaultExport: string;
  },
): Promise<boolean> {
  const source = await fs.readFile(absolute, "utf-8");
  const { ast, error } = parseRouteModuleWithError(source);
  const file = messages.file.replace(/^\.\//, "");

  if (!ast) {
    diagnostics.push({
      level: "error",
      file,
      message: `${messages.parseError}: ${formatParseError(error)}`,
    });
    return false;
  }

  if (!hasDefaultExport(ast)) {
    diagnostics.push({
      level: "error",
      file,
      message: messages.missingDefaultExport,
    });
    return false;
  }

  return true;
}

function formatParseError(error: unknown): string {
  return (
    getParseErrorMessage(error).split("\n").find(Boolean)?.trim() ??
    "Unknown parse error."
  );
}

async function collectSourceFiles(cwd: string, dir: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(current, entry.name);
      if (!isInsideCwd(cwd, absolute)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (entry.isFile() && isRouteSourceFile(entry.name)) {
        files.push(absolute);
      }
    }
  }

  await visit(dir);
  return files.sort();
}

function isRouteSourceFile(file: string): boolean {
  if (file.endsWith(".d.ts")) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  return SOURCE_EXTENSIONS.has(path.extname(file));
}

function toRouteFile(routeRel: string):
  | {
      name: string;
      segments: string[];
    }
  | undefined {
  const extension = path.extname(routeRel);
  if (!SOURCE_EXTENSIONS.has(extension)) return undefined;

  const withoutExt = routeRel.slice(0, -extension.length);
  const segments = withoutExt.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some(isPrivateRouteSegment)) return undefined;
  const name = segments[segments.length - 1] ?? "";
  if (name === "index") segments.pop();

  return { name, segments };
}

function isPrivateRouteSegment(segment: string): boolean {
  return segment.startsWith("_");
}

function findBracketRouteSegment(segments: string[]): string | undefined {
  return segments.find(
    (segment) => segment.startsWith("[") && segment.endsWith("]"),
  );
}

function routePathFromSegments(segments: string[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}

function routeIdFromPath(routePath: string): string {
  const id = routePath
    .replace(/^\/+|\/+$/g, "")
    .replace(/\$/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  return id || "index";
}

function compareRoutes(left: PageRouteNode, right: PageRouteNode): number {
  if (left.path === "/") return -1;
  if (right.path === "/") return 1;
  const leftDepth = left.path.split("/").length;
  const rightDepth = right.path.split("/").length;
  return leftDepth - rightDepth || left.path.localeCompare(right.path);
}

function toProjectPath(cwd: string, file: string): string {
  return `./${toPosixPath(path.relative(cwd, file))}`;
}

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, "/").replaceAll("\\", "/");
}

function isInsideCwd(cwd: string, candidate: string): boolean {
  const relative = path.relative(cwd, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}
