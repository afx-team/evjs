import type { DefaultBundlerConfig } from "../config/index.js";
import type {
  EmitApi,
  FrameworkSlot,
  FrameworkSlotName,
  PluginEmitIRContext,
} from "./index.js";

/** @internal Build-local factory used to isolate per-Page contribution ids. */
export const pluginEmitIRScopeFactory: unique symbol = Symbol.for(
  "@evjs/ev/plugin-emit-ir-scope-factory/v1",
) as never;

export interface ScopedPluginEmitIRContext {
  readonly emit: EmitApi;
  slot<K extends FrameworkSlotName>(name: K): FrameworkSlot<K>;
}

export type InternalPluginEmitIRContext<TBundlerCfg = DefaultBundlerConfig> =
  PluginEmitIRContext<TBundlerCfg> & {
    readonly [pluginEmitIRScopeFactory]: (
      namespace: string,
    ) => ScopedPluginEmitIRContext;
  };
