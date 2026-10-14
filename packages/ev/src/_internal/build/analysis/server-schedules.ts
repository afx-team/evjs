import type { ServerScheduleNode } from "@evjs/shared/manifest";
import { parseSync } from "@swc/core";
import type { CallExpression, Identifier, Span } from "@swc/types";
import type { Diagnostic } from "../graph/types.js";
import { detectUseServer } from "../utils.js";

const declarationSources = new Set(["@evjs/ev/schedule", "@alipay/evjs"]);

/** Read declarations without importing or executing application code. */
export function analyzeServerSchedules(
  source: string,
  module: string,
): {
  schedules: ServerScheduleNode[];
  diagnostics: Diagnostic[];
} {
  const schedules: ServerScheduleNode[] = [];
  const diagnostics: Diagnostic[] = [];
  if (!source.includes("defineSchedule")) return { schedules, diagnostics };
  let spanOffset = 1;
  const report = (message: string, span?: Span) => {
    const lines = Buffer.from(source)
      .subarray(0, (span?.start ?? spanOffset) - spanOffset)
      .toString()
      .split("\n");
    diagnostics.push({
      level: "error",
      file: module,
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      message,
    });
  };
  let ast: ReturnType<typeof parseSync>;
  try {
    // An empty statement anchors SWC versions whose byte spans are process-global.
    ast = parseSync(`;${source.replace(/^#!/, "//")}`, {
      syntax: "typescript",
      tsx: /\.[jt]sx$/.test(module),
      target: "esnext",
    });
    spanOffset = ast.span.start + 1;
  } catch (error) {
    report(`Schedule module could not be parsed: ${String(error)}`);
    return { schedules, diagnostics };
  }
  const bindings = new Map<string, number>();
  for (const item of ast.body) {
    if (
      item.type !== "ImportDeclaration" ||
      item.typeOnly ||
      !declarationSources.has(item.source.value)
    )
      continue;
    for (const specifier of item.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.isTypeOnly)
        continue;
      const imported = specifier.imported;
      const name = imported ? imported.value : specifier.local.value;
      if (name === "defineSchedule")
        bindings.set(specifier.local.value, context(specifier.local));
    }
  }
  if (!bindings.size) return { schedules, diagnostics };
  const isBinding = (node: Identifier) =>
    bindings.has(node.value) && bindings.get(node.value) === context(node);
  const accepted = new Set<Identifier>();
  for (const item of ast.body) {
    if (
      item.type !== "ExportDeclaration" ||
      item.declaration.type !== "VariableDeclaration"
    )
      continue;
    for (const variable of item.declaration.declarations) {
      const call = variable.init;
      if (
        call?.type !== "CallExpression" ||
        call.callee.type !== "Identifier" ||
        !isBinding(call.callee)
      )
        continue;
      accepted.add(call.callee);
      if (
        item.declaration.kind !== "const" ||
        variable.id.type !== "Identifier"
      ) {
        report(
          "defineSchedule requires a named export const declaration.",
          call.span,
        );
        continue;
      }
      const exportName = variable.id.value;
      try {
        if (detectUseServer(source))
          throw new Error('Schedule modules cannot use "use server".');
        const options = readOptions(call);
        const lines = Buffer.from(source)
          .subarray(0, call.span.start - spanOffset)
          .toString()
          .split("\n");
        schedules.push({
          id: options.id ?? exportName,
          module,
          exportName,
          cron: options.cron,
          disable: options.disable ?? false,
          line: lines.length,
          column: lines[lines.length - 1].length + 1,
        });
      } catch (error) {
        report(
          `Schedule "${exportName}": ${error instanceof Error ? error.message : String(error)}`,
          call.span,
        );
      }
    }
  }
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "ImportDeclaration" ||
      (typeof node.type === "string" && node.type.startsWith("Ts"))
    )
      return;
    if (
      node.type === "Identifier" &&
      isBinding(value as Identifier) &&
      !accepted.has(value as Identifier)
    ) {
      report(
        "defineSchedule must be called directly in export const name = defineSchedule({...}, handler).",
        (value as Identifier).span,
      );
      return;
    }
    Object.values(node).forEach(visit);
  }
  visit(ast);
  return { schedules, diagnostics };
}

function readOptions(call: CallExpression): {
  id?: string;
  cron: string;
  disable?: boolean;
} {
  if (call.arguments.length !== 2 || call.arguments.some((arg) => arg.spread)) {
    throw new Error("Expected literal options and a zero-argument handler.");
  }
  const options = call.arguments[0].expression;
  const handler = call.arguments[1].expression;
  if (options.type !== "ObjectExpression")
    throw new Error("Options must be an object literal.");
  if (
    handler.type === "FunctionExpression" ||
    handler.type === "ArrowFunctionExpression"
  ) {
    if (handler.params.length || handler.generator)
      throw new Error(
        "Handler must be a zero-argument, non-generator function.",
      );
  } else if (handler.type !== "Identifier") {
    throw new Error("Handler must be a function or a function identifier.");
  }
  const result: { id?: string; cron?: string; disable?: boolean } = {};
  const seen = new Set<string>();
  for (const property of options.properties) {
    if (
      property.type !== "KeyValueProperty" ||
      !["Identifier", "StringLiteral"].includes(property.key.type)
    ) {
      throw new Error(
        "Options must use literal id, cron and disable properties; spreads and computed keys are not supported.",
      );
    }
    const key = (property.key as { value: string }).value;
    if (seen.has(key)) throw new Error(`Duplicate option "${key}".`);
    seen.add(key);
    if (key === "id" || key === "cron") {
      if (
        property.value.type !== "StringLiteral" ||
        !property.value.value.trim() ||
        property.value.value !== property.value.value.trim()
      ) {
        throw new Error(
          `${key} must be a non-empty string literal without surrounding whitespace.`,
        );
      }
      result[key] = property.value.value;
    } else if (key === "disable") {
      if (property.value.type !== "BooleanLiteral")
        throw new Error("disable must be a boolean literal.");
      result.disable = property.value.value;
    } else {
      throw new Error(`Unknown option "${key}".`);
    }
  }
  if (!result.cron) throw new Error("cron is required.");
  return { ...result, cron: result.cron };
}

// SWC emits lexical contexts; @swc/types omits this resolver field.
function context(node: Identifier): number {
  return (node as Identifier & { ctxt: number }).ctxt;
}
