export const PLUGIN_HOOK_NAMES = [
  "buildStart",
  "buildOutput",
  "bundlerConfig",
  "buildEnd",
  "dispose",
  "transformHtml",
] as const;

/**
 * Plugin descriptor objects are open to package-local metadata, but lifecycle
 * hooks belong to setup(). Reserve current hook spellings, including casing
 * mistakes, so misplaced hooks fail instead of becoming ignored metadata.
 */
export function isPluginLifecycleDescriptorField(value: string): boolean {
  if ((PLUGIN_HOOK_NAMES as readonly string[]).includes(value)) return true;

  const normalized = value.toLowerCase();
  return PLUGIN_HOOK_NAMES.some((name) => name.toLowerCase() === normalized);
}
