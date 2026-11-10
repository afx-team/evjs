import type { StaticJsonValue } from "../serialization/static-json.js";

/** A browser replacement for one exact source module, supplied by a plugin. */
export interface ClientModuleReference {
  /** Source filename, resolved from the application root. No glob matching. */
  resource: string;
  references: Array<{
    /** Module-local identity. Multiple exports may share one reference. */
    id: string;
    factory: {
      /** Browser runtime: app-root-relative or absolute filename, or package specifier. */
      module: string;
      export: string;
    };
    /** Only data intended for the browser may be supplied here. */
    data: StaticJsonValue;
  }>;
  exports: Array<{ name: string; reference: string }>;
}

/** Normalized build input; never a deployment or browser manifest. */
export interface ClientModuleReferencePlan extends ClientModuleReference {
  id: string;
  pluginId: string;
}
