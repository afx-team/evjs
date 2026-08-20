import type { HttpMethod } from "@evjs/shared";
import type { ExportSpecifier, Expression, ModuleItem } from "@swc/types";
import {
  getIdentifierExportName,
  getModuleExportName,
} from "./module-exports.js";

type CallableResolution = "callable" | "generator" | "non-callable" | "unknown";

type LocalBinding =
  | { kind: "function"; generator: boolean }
  | {
      kind: "variable";
      declarationKind: "var" | "let" | "const";
      value?: Expression;
    }
  | { kind: "non-callable" }
  | { kind: "unknown" };

type MethodExportTarget =
  | { kind: "local"; localName: string }
  | { kind: "external" };

/**
 * Reject HTTP method exports whose initial value is statically known to be an
 * invalid handler. Values that require module evaluation remain the runtime's
 * responsibility so route anchors can compose handlers from private modules.
 */
export function validateServerRouteMethodExports(
  body: ModuleItem[],
  methods: HttpMethod[],
): string[] {
  const methodSet = new Set<string>(methods);
  const targets = collectMethodExportTargets(body, methodSet);
  const locals = collectLocalBindings(body);
  const diagnostics: string[] = [];

  for (const method of methods) {
    const methodTargets = targets.get(method) ?? [];
    if (methodTargets.length > 1) {
      diagnostics.push(
        `Server route method "${method}" is exported more than once. Keep one stable handler export per HTTP method.`,
      );
      continue;
    }

    const [target] = methodTargets;
    const resolution =
      target?.kind === "local"
        ? resolveLocalBinding(target.localName, locals, new Set())
        : "unknown";
    const diagnostic = formatCallableDiagnostic(method, resolution);
    if (diagnostic) diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function collectMethodExportTargets(
  body: ModuleItem[],
  methods: Set<string>,
): Map<string, MethodExportTarget[]> {
  const targets = new Map<string, MethodExportTarget[]>();
  const record = (method: string, target: MethodExportTarget): void => {
    const existing = targets.get(method);
    if (existing) {
      existing.push(target);
    } else {
      targets.set(method, [target]);
    }
  };

  for (const item of body) {
    if (item.type === "ExportDeclaration") {
      const declaration = item.declaration;
      if (
        declaration.type === "FunctionDeclaration" ||
        declaration.type === "ClassDeclaration"
      ) {
        if (declaration.type === "FunctionDeclaration" && !declaration.body) {
          // TypeScript overload signatures describe one runtime export. Only
          // the implementation declaration owns the callable value.
          continue;
        }
        const name = declaration.identifier.value;
        if (methods.has(name)) record(name, { kind: "local", localName: name });
        continue;
      }

      if (declaration.type === "VariableDeclaration" && !declaration.declare) {
        for (const variable of declaration.declarations) {
          if (
            variable.id.type === "Identifier" &&
            methods.has(variable.id.value)
          ) {
            record(variable.id.value, {
              kind: "local",
              localName: variable.id.value,
            });
          }
        }
      }
      continue;
    }

    if (item.type !== "ExportNamedDeclaration" || item.typeOnly) continue;

    for (const specifier of item.specifiers) {
      const exportName = getMethodExportName(specifier);
      if (!exportName || !methods.has(exportName)) continue;

      if (item.source || specifier.type !== "ExportSpecifier") {
        record(exportName, { kind: "external" });
        continue;
      }

      const localName = getIdentifierExportName(specifier.orig);
      record(
        exportName,
        localName ? { kind: "local", localName } : { kind: "external" },
      );
    }
  }

  return targets;
}

function getMethodExportName(specifier: ExportSpecifier): string | undefined {
  if (specifier.type === "ExportSpecifier") {
    if (specifier.isTypeOnly) return undefined;
    return getModuleExportName(specifier.exported ?? specifier.orig);
  }
  if (specifier.type === "ExportNamespaceSpecifier") {
    return getModuleExportName(specifier.name);
  }
  return undefined;
}

function collectLocalBindings(body: ModuleItem[]): Map<string, LocalBinding> {
  const bindings = new Map<string, LocalBinding>();

  for (const item of body) {
    if (item.type === "ImportDeclaration" && !item.typeOnly) {
      for (const specifier of item.specifiers) {
        bindings.set(specifier.local.value, { kind: "unknown" });
      }
      continue;
    }

    const declaration =
      item.type === "ExportDeclaration" ? item.declaration : item;
    if (declaration.type === "FunctionDeclaration") {
      const name = declaration.identifier.value;
      if (!declaration.declare && declaration.body) {
        bindings.set(name, {
          kind: "function",
          generator: declaration.generator,
        });
      } else if (!bindings.has(name)) {
        bindings.set(name, { kind: "unknown" });
      }
      continue;
    }

    if (declaration.type === "VariableDeclaration") {
      for (const variable of declaration.declarations) {
        if (variable.id.type !== "Identifier") continue;
        bindings.set(
          variable.id.value,
          declaration.declare
            ? { kind: "unknown" }
            : {
                kind: "variable",
                declarationKind: declaration.kind,
                ...(variable.init ? { value: variable.init } : {}),
              },
        );
      }
      continue;
    }

    if (declaration.type === "ClassDeclaration") {
      bindings.set(declaration.identifier.value, { kind: "non-callable" });
    }
  }

  return bindings;
}

function resolveLocalBinding(
  name: string,
  bindings: Map<string, LocalBinding>,
  seen: Set<string>,
): CallableResolution {
  if (seen.has(name)) return "unknown";
  const binding = bindings.get(name);
  if (!binding) return "unknown";
  if (binding.kind === "function") {
    return binding.generator ? "generator" : "callable";
  }
  if (binding.kind === "non-callable") return "non-callable";
  if (binding.kind === "unknown") return "unknown";
  if (binding.declarationKind !== "const" || !binding.value) return "unknown";

  return resolveExpression(binding.value, bindings, new Set([...seen, name]));
}

function resolveExpression(
  value: Expression,
  bindings: Map<string, LocalBinding>,
  seen: Set<string>,
): CallableResolution {
  const expression = unwrapExpression(value);
  if (expression.type === "ArrowFunctionExpression") return "callable";
  if (expression.type === "FunctionExpression") {
    return expression.generator ? "generator" : "callable";
  }
  if (expression.type === "Identifier") {
    return resolveLocalBinding(expression.value, bindings, seen);
  }
  if (
    expression.type === "StringLiteral" ||
    expression.type === "NumericLiteral" ||
    expression.type === "BigIntLiteral" ||
    expression.type === "BooleanLiteral" ||
    expression.type === "NullLiteral" ||
    expression.type === "RegExpLiteral" ||
    expression.type === "TemplateLiteral" ||
    expression.type === "ArrayExpression" ||
    expression.type === "ObjectExpression" ||
    expression.type === "ClassExpression" ||
    expression.type === "JSXElement" ||
    expression.type === "JSXFragment"
  ) {
    return "non-callable";
  }
  return "unknown";
}

function unwrapExpression(expression: Expression): Expression {
  let current = expression;
  while (
    current.type === "ParenthesisExpression" ||
    current.type === "TsAsExpression" ||
    current.type === "TsConstAssertion" ||
    current.type === "TsInstantiation" ||
    current.type === "TsNonNullExpression" ||
    current.type === "TsSatisfiesExpression" ||
    current.type === "TsTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function formatCallableDiagnostic(
  method: HttpMethod,
  resolution: CallableResolution,
): string | undefined {
  if (resolution === "callable" || resolution === "unknown") return undefined;
  if (resolution === "generator") {
    return `Server route method "${method}" cannot be a generator function. HTTP method handlers must return a Response or Promise<Response>, not an iterator.`;
  }
  return `Server route method "${method}" must resolve to a function. Non-callable values such as strings, objects, and classes are not valid HTTP handlers.`;
}
