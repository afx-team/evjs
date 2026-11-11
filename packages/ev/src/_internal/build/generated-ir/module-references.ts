import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { assertStaticJsonValue } from "@evjs/shared/_internal/static-json";
import type {
  ClientModuleReference,
  ClientModuleReferencePlan,
} from "@evjs/shared/manifest";

const exportName = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Normalize without evaluating source code or interpreting payload semantics. */
export function normalizeClientModuleReference(
  cwd: string,
  pluginId: string,
  input: ClientModuleReference & { id: string },
): ClientModuleReferencePlan {
  const label = `Plugin "${pluginId}" module reference "${input.id}"`;
  assertStaticJsonValue(input, label);
  if (typeof input.resource !== "string" || !input.resource.trim()) {
    throw new Error(`[evjs] ${label} requires a source filename.`);
  }
  const root = realpathSync(cwd);
  const resource = realpathSync(path.resolve(root, input.resource));
  const relative = path.relative(root, resource);
  if (
    !statSync(resource).isFile() ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `[evjs] ${label} source must be a file inside the application root.`,
    );
  }
  if (!Array.isArray(input.references) || input.references.length === 0) {
    throw new Error(`[evjs] ${label} requires at least one reference.`);
  }
  const ids = new Set<string>();
  const references = input.references.map((reference) => {
    if (
      !reference ||
      typeof reference !== "object" ||
      Array.isArray(reference)
    ) {
      throw new Error(`[evjs] ${label} requires reference objects.`);
    }
    if (
      typeof reference.id !== "string" ||
      !reference.id ||
      ids.has(reference.id)
    ) {
      throw new Error(
        `[evjs] ${label} has a missing or duplicate reference id.`,
      );
    }
    ids.add(reference.id);
    if (
      !reference.factory ||
      typeof reference.factory.module !== "string" ||
      !reference.factory.module.trim() ||
      typeof reference.factory.export !== "string" ||
      !exportName.test(reference.factory.export)
    ) {
      throw new Error(
        `[evjs] ${label} requires a runtime module and factory export.`,
      );
    }
    assertStaticJsonValue(
      reference.data,
      `${label} reference "${reference.id}" data`,
    );
    const runtime = reference.factory.module;
    return {
      id: reference.id,
      factory: {
        module: runtime.startsWith(".") ? path.resolve(root, runtime) : runtime,
        export: reference.factory.export,
      },
      data: structuredClone(reference.data),
    };
  });
  if (!Array.isArray(input.exports) || input.exports.length === 0) {
    throw new Error(`[evjs] ${label} requires at least one export.`);
  }
  const names = new Set<string>();
  const exports = input.exports.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`[evjs] ${label} requires export objects.`);
    }
    if (
      typeof item.name !== "string" ||
      !exportName.test(item.name) ||
      names.has(item.name)
    ) {
      throw new Error(
        `[evjs] ${label} has an invalid or duplicate export name.`,
      );
    }
    names.add(item.name);
    if (!ids.has(item.reference)) {
      throw new Error(
        `[evjs] ${label} export "${item.name}" points to an unknown reference.`,
      );
    }
    return { name: item.name, reference: item.reference };
  });
  return { id: input.id, pluginId, resource, references, exports };
}
