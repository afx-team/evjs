import type { FrameworkSlotName } from "@evjs/shared/manifest";
import type { PluginHookName } from "./errors.js";
import type { EmitApi, FrameworkSlot, PluginEmitIRContext } from "./index.js";

export type PluginEmissionHook = Extract<
  PluginHookName,
  "emitIR" | "emitPageIR"
>;

export interface PluginEmissionApi {
  readonly emit: EmitApi;
  slot<K extends FrameworkSlotName>(name: K): FrameworkSlot<K>;
}

type PluginEmissionContext = Pick<
  PluginEmitIRContext<unknown>,
  "emit" | "slot"
>;

const pluginEmissionScope = Symbol("evjs.plugin-emission-scope");

interface PluginEmissionScopeCarrier {
  readonly [pluginEmissionScope]?: (
    hook: PluginEmissionHook,
  ) => PluginEmissionApi;
}

/** @internal Attach the collector-owned origin switch to one hook context. */
export function attachPluginEmissionScope(
  context: PluginEmissionContext,
  createScope: (hook: PluginEmissionHook) => PluginEmissionApi,
): void {
  Object.defineProperty(context, pluginEmissionScope, {
    configurable: false,
    enumerable: false,
    value: createScope,
    writable: false,
  });
}

/** @internal Resolve emit/slot functions tagged with the descriptor hook origin. */
export function getPluginEmissionApi(
  context: PluginEmissionContext,
  hook: PluginEmissionHook,
): PluginEmissionApi {
  return (
    (context as PluginEmissionScopeCarrier)[pluginEmissionScope]?.(hook) ?? {
      emit: context.emit,
      slot: context.slot,
    }
  );
}
