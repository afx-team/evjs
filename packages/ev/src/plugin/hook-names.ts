export const PLUGIN_HOOK_NAMES = [
  "configureBundler",
  "beforeBuild",
  "transformOutput",
  "transformHtml",
  "afterBuild",
  "dispose",
] as const;

/**
 * Plugin descriptors are strict and lifecycle hooks belong to setup().
 * Recognize current hook spellings, including casing mistakes, so misplaced
 * hooks receive a focused diagnostic.
 */
export function isPluginLifecycleDescriptorField(value: string): boolean {
  if ((PLUGIN_HOOK_NAMES as readonly string[]).includes(value)) return true;

  const normalized = value.toLowerCase();
  return PLUGIN_HOOK_NAMES.some((name) => name.toLowerCase() === normalized);
}
