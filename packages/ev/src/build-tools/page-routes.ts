import fs from "node:fs/promises";
import path from "node:path";
import type { PageRouteNode } from "@evjs/shared/manifest";

export interface DiscoverPageRoutesOptions {
  dir: string;
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
const ROOT_LAYOUT_INDEX_FILE = "layout/index.tsx";

export async function discoverPageRoutes(
  cwd: string,
  options: DiscoverPageRoutesOptions,
): Promise<PageRouteDiscovery> {
  const absoluteDir = path.resolve(cwd, options.dir);
  const files = await collectSourceFiles(cwd, absoluteDir);
  const routes: PageRouteNode[] = [];
  const diagnostics: PageRouteDiscoveryDiagnostic[] = [];
  const rootModule = await discoverRootLayout(cwd, absoluteDir, diagnostics);
  const routeByPath = new Map<string, string>();

  for (const file of files) {
    const sourceRel = toProjectPath(cwd, file);
    const routeRel = toPosixPath(path.relative(absoluteDir, file));
    if (routeRel === ROOT_LAYOUT_FILE) {
      const expected = toProjectPath(
        cwd,
        path.join(path.dirname(absoluteDir), ROOT_LAYOUT_FILE),
      );
      diagnostics.push({
        level: "error",
        file: sourceRel.replace(/^\.\//, ""),
        message: `Root layout files must live at ${expected}, not inside the page route directory.`,
      });
      continue;
    }

    const routeFile = toRouteFile(routeRel);
    if (!routeFile) continue;

    const routePath = routePathFromSegments(routeFile.segments);
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

async function discoverRootLayout(
  cwd: string,
  absoluteRouteDir: string,
  diagnostics: PageRouteDiscoveryDiagnostic[],
): Promise<string | undefined> {
  const appDir = path.dirname(absoluteRouteDir);
  if (!isInsideCwd(cwd, appDir)) return undefined;

  const absolute = path.join(appDir, ROOT_LAYOUT_FILE);
  const indexed = path.join(appDir, ROOT_LAYOUT_INDEX_FILE);
  const expected = toProjectPath(cwd, absolute);
  const actual = toProjectPath(cwd, indexed);

  try {
    await fs.access(indexed);
    diagnostics.push({
      level: "error",
      file: actual.replace(/^\.\//, ""),
      message: `Root layout must be a single file at ${expected}. ${actual} is not supported.`,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  try {
    await fs.access(absolute);
    return toProjectPath(cwd, absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return undefined;
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
  const name = segments[segments.length - 1] ?? "";
  if (name.startsWith("_")) return undefined;
  if (name === "index") segments.pop();

  return { name, segments };
}

function routePathFromSegments(segments: string[]): string {
  if (segments.length === 0) return "/";
  return `/${segments.map(routeSegment).filter(Boolean).join("/")}`;
}

function routeSegment(segment: string): string {
  if (segment.startsWith("[...") && segment.endsWith("]")) return "$";
  if (segment.startsWith("[") && segment.endsWith("]")) {
    return `$${segment.slice(1, -1)}`;
  }
  return segment;
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
