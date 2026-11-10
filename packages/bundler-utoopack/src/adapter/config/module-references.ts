import { isDeepStrictEqual } from "node:util";
import type { BuildPlan, ClientModuleReference } from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";

// Kept structural until the native capability is available in a published
// @utoo/pack release. Execution must also verify moduleReferencesVersion.
export type UtoopackModuleReferenceConfig = ConfigComplete & {
  module?: NonNullable<ConfigComplete["module"]> & {
    references?: ClientModuleReference[];
  };
};

export function createUtoopackModuleReferences(
  plan: BuildPlan,
): ClientModuleReference[] | undefined {
  if (!plan.clientModuleReferences?.length) return undefined;
  return plan.clientModuleReferences.map(({ resource, references, exports }) =>
    structuredClone({ resource, references, exports }),
  );
}

export function assertUtoopackModuleReferencesMatchPlan(
  config: UtoopackModuleReferenceConfig,
  expected: ClientModuleReference[] | undefined,
): void {
  if (!isDeepStrictEqual(config.module?.references, expected)) {
    throw new Error(
      "[evjs] Utoopack module.references must remain the exact framework-owned BuildPlan references. configureBundler hooks cannot change browser module boundaries.",
    );
  }
}

export function assertUtoopackModuleReferenceSupport(
  runtime: { moduleReferencesVersion?: number },
  config: UtoopackModuleReferenceConfig,
): void {
  if (
    config.module?.references?.length &&
    runtime.moduleReferencesVersion !== 1
  ) {
    throw new Error(
      "[evjs] This build requires @utoo/pack moduleReferencesVersion=1. Install a Utoopack build with native module reference support before using emit.moduleReference(). Refusing to bundle the original source modules.",
    );
  }
}
