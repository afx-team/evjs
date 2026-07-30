export const PLUGIN_HOOK_ERROR_CODE = "EV_PLUGIN_HOOK_ERROR";

export type PluginHookName =
  | "configure"
  | "setup"
  | "emitIR"
  | "emitPageIR"
  | "configureBundler"
  | "beforeBuild"
  | "transformOutput"
  | "transformHtml"
  | "afterBuild"
  | "dispose";

/** Error raised when one named plugin hook fails. */
export class PluginHookError extends Error {
  readonly code = PLUGIN_HOOK_ERROR_CODE;
  readonly plugin: string;
  readonly hook: PluginHookName;

  constructor(plugin: string, hook: PluginHookName, cause: unknown) {
    super(
      `[evjs] Plugin "${plugin}" hook "${hook}" failed: ${formatCause(cause)}`,
      { cause },
    );
    this.name = "PluginHookError";
    this.plugin = plugin;
    this.hook = hook;
  }
}

/** @internal Add stable plugin/hook attribution without wrapping twice. */
export async function runPluginHook<TResult>(
  plugin: string,
  hook: PluginHookName,
  callback: () => TResult | Promise<TResult>,
): Promise<TResult> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof PluginHookError) throw error;
    throw new PluginHookError(plugin, hook, error);
  }
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
