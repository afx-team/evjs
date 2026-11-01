import { HTTP_METHODS } from "@evjs/shared";
import type { Expression, Module, ObjectExpression } from "@swc/types";
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
  const helperBindings = collectHttpBindings(ast);
  const helperHandlers = new Map<string, Expression>();
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
      if (HTTP_METHODS.some((method) => method === name)) {
        fail(
          `http.* export "${name}" must use a business operation name such as "listOrders"; declare the HTTP verb in the method field.`,
        );
        continue;
      }
      const value = unwrapExpression(declaration.init);
      const helper = readHttpBinding(value, helperBindings);
      let object: ObjectExpression | undefined;
      let method: string | undefined;
      if (helper) {
        const args = helper.call.arguments;
        const handler = args[0];
        if (!handler || args.length > 2 || args.some((arg) => arg.spread)) {
          fail(
            `HTTP operation "${name}" requires a handler and optional static options.`,
          );
          continue;
        }
        helperHandlers.set(name, unwrapExpression(handler.expression));
        method = helper.method;
        if (args[1]) {
          const options = unwrapExpression(args[1].expression);
          if (options.type !== "ObjectExpression") {
            fail(`HTTP operation "${name}" requires a static options object.`);
            continue;
          }
          object = options;
        }
      } else if (value.type === "ObjectExpression") {
        object = value;
      } else {
        fail(
          `HTTP operation "${name}" requires http.get/post/put/patch/delete/head/options(handler, options?) from @evjs/ev/api or a static { method, path?, handler } object.`,
        );
        continue;
      }
      let suffix = "/";
      const fields = new Set<string>();
      const errorsBefore = diagnostics.length;
      for (const property of object?.properties ?? []) {
        if (property.type === "SpreadElement") {
          fail(`HTTP operation "${name}" cannot spread routing metadata.`);
          continue;
        }
        const key = property.type === "Identifier" ? property : property.key;
        if (key.type !== "Identifier" && key.type !== "StringLiteral") {
          fail(`HTTP operation "${name}" requires static property names.`);
          continue;
        }
        if (key.value !== "method" && key.value !== "path") continue;
        if (helper && key.value === "method") {
          fail(
            `HTTP operation "${name}" gets its method from http.${helper.method.toLowerCase()}(); omit method from options.`,
          );
          continue;
        }
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
  for (const message of validateServerRouteMethodExports(
    ast.body,
    [...definitions],
    helperHandlers,
  ))
    fail(message);
  for (const route of routes.values()) {
    route.methods = HTTP_METHODS.filter((method) =>
      route.methods.includes(method),
    );
    route.id = `${file}:${route.path}:${route.methods.join(",")}`;
  }
  return { routes: [...routes.values()], diagnostics };
}

interface HttpBindings {
  named: Set<string>;
  namespaces: Set<string>;
}

function collectHttpBindings(ast: Module): HttpBindings {
  const bindings: HttpBindings = { named: new Set(), namespaces: new Set() };
  for (const item of ast.body) {
    if (
      item.type !== "ImportDeclaration" ||
      item.typeOnly ||
      !["@evjs/ev/api", "@alipay/evjs/api"].includes(item.source.value)
    )
      continue;
    for (const specifier of item.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        bindings.namespaces.add(specifier.local.value);
      } else if (
        specifier.type === "ImportSpecifier" &&
        !specifier.isTypeOnly &&
        (specifier.imported?.value ?? specifier.local.value) === "http"
      ) {
        bindings.named.add(specifier.local.value);
      }
    }
  }
  return bindings;
}

function readHttpBinding(value: Expression, bindings: HttpBindings) {
  if (
    value.type !== "CallExpression" ||
    value.callee.type !== "MemberExpression"
  )
    return;
  const callee = value.callee;
  if (callee.property.type !== "Identifier") return;
  const method = callee.property.value.toUpperCase();
  if (
    callee.property.value !== method.toLowerCase() ||
    !HTTP_METHODS.some((candidate) => candidate === method)
  )
    return;
  const receiver = unwrapExpression(callee.object);
  const known =
    receiver.type === "Identifier"
      ? bindings.named.has(receiver.value)
      : receiver.type === "MemberExpression" &&
        receiver.property.type === "Identifier" &&
        receiver.property.value === "http" &&
        receiver.object.type === "Identifier" &&
        bindings.namespaces.has(receiver.object.value);
  if (known) return { method, call: value };
}
