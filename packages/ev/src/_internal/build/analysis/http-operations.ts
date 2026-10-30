import { HTTP_METHODS } from "@evjs/shared";
import type { Module } from "@swc/types";
import { resolveHttpOperationPath } from "../conventions/http-operation-path.js";
import type {
  DiscoveredServerRouteNode,
  ServerRouteDiscoveryDiagnostic,
} from "../discovery/server-routes.js";
import { collectModuleExportNames } from "./module-exports.js";
import { hasDefaultExport } from "./route-module.js";
import {
  unwrapExpression,
  validateServerRouteMethodExports,
} from "./server-route-exports.js";

/** Static HTTP declarations: each export owns its method, suffix and callable handler. */
export function analyzeHttpOperations(
  ast: Module,
  file: string,
  basePath: string,
  segments: string[],
): {
  routes: DiscoveredServerRouteNode[];
  diagnostics: ServerRouteDiscoveryDiagnostic[];
} {
  const diagnostics: ServerRouteDiscoveryDiagnostic[] = [];
  const routes = new Map<
    string,
    DiscoveredServerRouteNode & { handlerExports: Record<string, string> }
  >();
  const exports = collectModuleExportNames(ast.body);
  const definitions = new Set<string>();
  const fail = (message: string) =>
    diagnostics.push({ level: "error", file, message });
  if (hasDefaultExport(ast)) fail("http.* requires named operation exports.");
  for (const item of ast.body) {
    if (
      item.type !== "ExportDeclaration" ||
      item.declaration.type !== "VariableDeclaration" ||
      item.declaration.kind !== "const"
    )
      continue;
    for (const declaration of item.declaration.declarations) {
      if (declaration.id.type !== "Identifier" || !declaration.init) continue;
      const name = declaration.id.value;
      definitions.add(name);
      const object = unwrapExpression(declaration.init);
      if (object.type !== "ObjectExpression") {
        fail(
          `HTTP operation "${name}" requires a static { method, path?, handler } object.`,
        );
        continue;
      }
      let method: string | undefined;
      let suffix = "/";
      const fields = new Set<string>();
      const errorsBefore = diagnostics.length;
      for (const property of object.properties) {
        if (property.type === "SpreadElement") {
          fail(`HTTP operation "${name}" cannot spread routing metadata.`);
          continue;
        }
        if (property.type === "Identifier") continue;
        const key = property.key;
        if (key.type !== "Identifier" && key.type !== "StringLiteral") {
          fail(`HTTP operation "${name}" requires static property names.`);
          continue;
        }
        if (key.value !== "method" && key.value !== "path") continue;
        if (fields.has(key.value))
          fail(`HTTP operation "${name}" repeats "${key.value}".`);
        fields.add(key.value);
        if (property.type !== "KeyValueProperty") {
          fail(
            `HTTP operation "${name}" requires a static ${key.value} string.`,
          );
          continue;
        }
        const value = unwrapExpression(property.value);
        if (value.type !== "StringLiteral") {
          fail(
            `HTTP operation "${name}" requires a static ${key.value} string.`,
          );
          continue;
        }
        if (key.value === "method") method = value.value;
        else suffix = value.value;
      }
      if (!method || !HTTP_METHODS.some((value) => value === method)) {
        fail(
          `HTTP operation "${name}" requires an uppercase method such as GET or POST.`,
        );
      }
      if (diagnostics.length !== errorsBefore || !method) continue;
      let pathname: string;
      try {
        pathname = resolveHttpOperationPath(basePath, suffix);
      } catch (error) {
        fail(String((error as Error).message));
        continue;
      }
      let route = routes.get(pathname);
      if (!route) {
        route = {
          id: `${file}:${pathname}`,
          module: file,
          path: pathname,
          methods: [],
          handlerExports: {},
          moduleSegments: segments,
        };
        routes.set(pathname, route);
      }
      if (route.handlerExports?.[method]) {
        fail(
          `Duplicate HTTP operation ${method} ${pathname}: "${route.handlerExports[method]}" and "${name}".`,
        );
        continue;
      }
      route.methods.push(method);
      route.handlerExports[method] = name;
    }
  }
  for (const name of exports) {
    if (!definitions.has(name) && name !== "default")
      fail(
        `HTTP operation "${name}" must be a named const descriptor in http.*.`,
      );
  }
  if (!definitions.size)
    fail("http.* requires at least one named operation descriptor.");
  for (const message of validateServerRouteMethodExports(ast.body, [
    ...definitions,
  ]))
    fail(message);
  for (const route of routes.values()) {
    route.methods = HTTP_METHODS.filter((method) =>
      route.methods.includes(method),
    );
    route.id = `${file}:${route.path}:${route.methods.join(",")}`;
  }
  return { routes: [...routes.values()], diagnostics };
}
