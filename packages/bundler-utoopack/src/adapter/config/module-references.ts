import { isDeepStrictEqual } from "node:util";
import type { BuildPlan, ClientModuleReference } from "@evjs/shared/manifest";
import type { ConfigComplete } from "@utoo/pack";

type MutableReferenceData =
  | null
  | boolean
  | number
  | string
  | MutableReferenceData[]
  | { [key: string]: MutableReferenceData };

type UtoopackModuleReference = Omit<ClientModuleReference, "references"> & {
  references: Array<
    Omit<ClientModuleReference["references"][number], "data"> & {
      data: MutableReferenceData;
    }
  >;
};

// Keep framework ownership independent of the installed native package version.
// Execution must also verify moduleReferencesVersion.
export type UtoopackModuleReferenceConfig = ConfigComplete & {
  module?: NonNullable<ConfigComplete["module"]> & {
    references?: UtoopackModuleReference[];
  };
};

export function createUtoopackModuleReferences(
  plan: BuildPlan,
): UtoopackModuleReference[] | undefined {
  if (!plan.clientModuleReferences?.length) return undefined;
  return plan.clientModuleReferences.map(
    ({ resource, references, exports }) =>
      // structuredClone creates mutable arrays and objects even when the plan
      // snapshot is deeply readonly. Native package types describe that copy.
      structuredClone({
        resource,
        references,
        exports,
      }) as UtoopackModuleReference,
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
